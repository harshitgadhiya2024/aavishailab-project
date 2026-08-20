// Package mitm implements per-organization TLS interception infrastructure:
// a root CA generated and held (private key encrypted) by admin-api, and
// on-demand short-lived leaf-certificate signing for the endpoint agent's
// local TLS-terminating proxy.
//
// Deliberate security choices:
//   - One CA per org, not one platform-wide CA — a compromised org (or a
//     customer offboarding) only ever invalidates trust for that org's own
//     devices.
//   - The CA private key never leaves admin-api. The agent generates its own
//     per-host key pair locally and only ever sends a CSR (public key) over
//     the wire; admin-api signs a short-lived (72h) leaf cert and returns
//     it. A stolen laptop yields, at most, its already-cached leaf certs —
//     never the ability to mint new ones.
//   - The CA private key is encrypted at rest with AES-256-GCM under a
//     server-only key (CA_KEY_ENCRYPTION_KEY); a database dump alone can't
//     recover it.
package mitm

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// LeafCertValidity is deliberately short — a leaf only needs to outlive one
// browsing session's worth of caching, and a short lifetime bounds how long
// a leaked leaf key (not the CA key, which never leaves the server) stays
// useful.
const LeafCertValidity = 72 * time.Hour

// CA holds a decrypted org CA in memory for the duration of one request —
// never persisted outside the encrypted DB column.
type CA struct {
	Cert    *x509.Certificate
	Key     *ecdsa.PrivateKey
	CertPEM []byte
}

func encryptionKey() ([]byte, error) {
	raw := os.Getenv("CA_KEY_ENCRYPTION_KEY")
	if raw == "" {
		return nil, errors.New("CA_KEY_ENCRYPTION_KEY is not set — required to protect org CA private keys at rest")
	}
	// SHA-256 the configured secret down to exactly 32 bytes, so operators
	// can set any passphrase length rather than needing an exact-size key.
	key := sha256.Sum256([]byte(raw))
	return key[:], nil
}

// encryptKey seals raw key bytes (a PEM-encoded private key) for storage in
// the DB, returning a base64 string of nonce||ciphertext.
func encryptKey(plaintext []byte) (string, error) {
	key, err := encryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func decryptKey(encoded string) ([]byte, error) {
	key, err := encryptionKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	sealed, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("malformed sealed key: %w", err)
	}
	if len(sealed) < gcm.NonceSize() {
		return nil, errors.New("sealed key too short")
	}
	nonce, ciphertext := sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ciphertext, nil)
}

// EnsureOrgCA returns the org's existing root CA, generating and persisting
// a new one on first use. Called from the agent-facing endpoints, so it must
// be safe under concurrent first-calls for the same org — a unique index on
// org_id plus a create-then-refetch-on-conflict pattern handles that.
func EnsureOrgCA(db *gorm.DB, orgID uuid.UUID) (*CA, error) {
	var row models.OrgCACert
	err := db.Where("org_id = ?", orgID).First(&row).Error
	if err == nil {
		return loadCA(&row)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	ca, row2, err := generateOrgCA(orgID)
	if err != nil {
		return nil, err
	}
	if createErr := db.Create(row2).Error; createErr != nil {
		// Lost the race with a concurrent first-caller for the same org —
		// fetch what they created instead of erroring.
		var existing models.OrgCACert
		if fetchErr := db.Where("org_id = ?", orgID).First(&existing).Error; fetchErr == nil {
			return loadCA(&existing)
		}
		return nil, createErr
	}
	return ca, nil
}

func generateOrgCA(orgID uuid.UUID) (*CA, *models.OrgCACert, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, err
	}

	notBefore := time.Now().Add(-time.Hour)
	notAfter := time.Now().AddDate(10, 0, 0)

	template := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   "Aavishield SSL Inspection CA",
			Organization: []string{"Aavishield"},
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLenZero:        true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyBytes, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes})

	encryptedKey, err := encryptKey(keyPEM)
	if err != nil {
		return nil, nil, err
	}

	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return nil, nil, err
	}

	row := &models.OrgCACert{
		OrgID:           orgID,
		CertPEM:         string(certPEM),
		EncryptedKeyPEM: encryptedKey,
		SerialNumber:    serial.String(),
		ExpiresAt:       notAfter,
	}

	return &CA{Cert: cert, Key: key, CertPEM: certPEM}, row, nil
}

func loadCA(row *models.OrgCACert) (*CA, error) {
	keyPEM, err := decryptKey(row.EncryptedKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt org CA key: %w", err)
	}
	keyBlock, _ := pem.Decode(keyPEM)
	if keyBlock == nil {
		return nil, errors.New("malformed CA key PEM")
	}
	key, err := x509.ParseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		return nil, err
	}

	certBlock, _ := pem.Decode([]byte(row.CertPEM))
	if certBlock == nil {
		return nil, errors.New("malformed CA cert PEM")
	}
	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return nil, err
	}

	return &CA{Cert: cert, Key: key, CertPEM: []byte(row.CertPEM)}, nil
}
