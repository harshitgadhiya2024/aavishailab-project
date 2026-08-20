package mitm

import (
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"testing"

	"github.com/google/uuid"
)

func TestMain(m *testing.M) {
	os.Setenv("CA_KEY_ENCRYPTION_KEY", "test-only-encryption-key-do-not-use-in-prod")
	os.Exit(m.Run())
}

func TestGenerateOrgCA_IsCA(t *testing.T) {
	ca, row, err := generateOrgCA(uuid.New())
	if err != nil {
		t.Fatalf("generateOrgCA: %v", err)
	}
	if !ca.Cert.IsCA {
		t.Fatal("expected generated cert to have IsCA=true")
	}
	if row.EncryptedKeyPEM == "" {
		t.Fatal("expected encrypted key to be stored")
	}
	if row.EncryptedKeyPEM == string(mustMarshalKeyPEM(t, ca)) {
		t.Fatal("private key must not be stored in plaintext")
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	secret := []byte("-----BEGIN EC PRIVATE KEY-----\nfake\n-----END EC PRIVATE KEY-----")
	enc, err := encryptKey(secret)
	if err != nil {
		t.Fatalf("encryptKey: %v", err)
	}
	if enc == string(secret) {
		t.Fatal("ciphertext must differ from plaintext")
	}
	dec, err := decryptKey(enc)
	if err != nil {
		t.Fatalf("decryptKey: %v", err)
	}
	if string(dec) != string(secret) {
		t.Fatal("decrypted key does not match original")
	}
}

func TestLoadCA_RoundTripsGeneratedCA(t *testing.T) {
	orgID := uuid.New()
	_, row, err := generateOrgCA(orgID)
	if err != nil {
		t.Fatalf("generateOrgCA: %v", err)
	}
	loaded, err := loadCA(row)
	if err != nil {
		t.Fatalf("loadCA: %v", err)
	}
	if loaded.Cert.SerialNumber.String() != row.SerialNumber {
		t.Fatal("loaded cert serial does not match stored serial")
	}
}

// TestIssueLeafCert_VerifiesAgainstCA proves the whole point of this
// package: a leaf cert issued for "internal.example.com" actually validates
// as a legitimate certificate chain when checked against the org's CA, the
// same way a browser would check it during a TLS handshake — and that the
// returned key actually matches the returned cert.
func TestIssueLeafCert_VerifiesAgainstCA(t *testing.T) {
	ca, _, err := generateOrgCA(uuid.New())
	if err != nil {
		t.Fatalf("generateOrgCA: %v", err)
	}

	leafCertPEM, leafKeyPEM, err := IssueLeafCert(ca, "internal.example.com")
	if err != nil {
		t.Fatalf("IssueLeafCert: %v", err)
	}

	leafBlock, _ := pem.Decode(leafCertPEM)
	leafCert, err := x509.ParseCertificate(leafBlock.Bytes)
	if err != nil {
		t.Fatalf("parse leaf cert: %v", err)
	}

	keyBlock, _ := pem.Decode(leafKeyPEM)
	leafKey, err := x509.ParseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		t.Fatalf("parse leaf key: %v", err)
	}
	if !leafKey.PublicKey.Equal(leafCert.PublicKey.(*ecdsa.PublicKey)) {
		t.Fatal("returned key does not match returned cert's public key")
	}

	pool := x509.NewCertPool()
	pool.AddCert(ca.Cert)
	if _, err := leafCert.Verify(x509.VerifyOptions{
		DNSName:   "internal.example.com",
		Roots:     pool,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}); err != nil {
		t.Fatalf("leaf cert failed to verify against org CA: %v", err)
	}

	// A hostname the leaf wasn't issued for must fail verification.
	if _, err := leafCert.Verify(x509.VerifyOptions{
		DNSName:   "not-the-right-host.example.com",
		Roots:     pool,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}); err == nil {
		t.Fatal("expected verification to fail for the wrong hostname")
	}
}

func mustMarshalKeyPEM(t *testing.T, ca *CA) []byte {
	t.Helper()
	b, err := x509.MarshalECPrivateKey(ca.Key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: b})
}
