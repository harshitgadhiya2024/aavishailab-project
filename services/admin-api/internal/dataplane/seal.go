package dataplane

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"strings"
)

// Company database passwords and bucket keys are sealed with AES-256-GCM
// before they are written to org_data_residency, so a dump of Aavishield's
// database alone does not hand anyone the keys to a customer's data.
//
// The key is derived from CA_KEY_ENCRYPTION_KEY — already a required,
// strength-checked production secret (see internal/secrets) — under its own
// label, so the two uses never share a key and no new secret has to be
// provisioned before this feature can be deployed.

const sealPrefix = "v1:"

var errNoSealKey = errors.New("CA_KEY_ENCRYPTION_KEY is not set — required to protect data-residency credentials")

func sealKey() ([]byte, error) {
	raw := os.Getenv("CA_KEY_ENCRYPTION_KEY")
	if raw == "" {
		return nil, errNoSealKey
	}
	sum := sha256.Sum256([]byte("aavishield/data-residency/v1\x00" + raw))
	return sum[:], nil
}

// Seal encrypts plaintext for storage.
func Seal(plaintext []byte) (string, error) {
	key, err := sealKey()
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return sealPrefix + base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, plaintext, nil)), nil
}

// Open decrypts what Seal produced.
func Open(sealed string) ([]byte, error) {
	if !strings.HasPrefix(sealed, sealPrefix) {
		return nil, errors.New("unrecognised sealed value")
	}
	key, err := sealKey()
	if err != nil {
		return nil, err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(sealed, sealPrefix))
	if err != nil {
		return nil, err
	}
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	if len(raw) < gcm.NonceSize() {
		return nil, errors.New("sealed value too short")
	}
	return gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
