// Package secretbox seals small secrets at rest with AES-256-GCM under a key
// derived from CA_KEY_ENCRYPTION_KEY — the same already-required, strength-
// checked production secret used for org CA keys and data-residency
// credentials. A per-use label namespaces the derived key so two different
// kinds of secret never share one.
//
// Open tolerates a legacy plaintext value (one without the version prefix) and
// returns it unchanged, so turning encryption on for a column that already
// holds plaintext needs no flag-day migration.
package secretbox

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

const prefix = "v1:"

var errNoKey = errors.New("CA_KEY_ENCRYPTION_KEY is not set — required to seal secrets at rest")

func key(label string) ([]byte, error) {
	raw := os.Getenv("CA_KEY_ENCRYPTION_KEY")
	if raw == "" {
		return nil, errNoKey
	}
	sum := sha256.Sum256([]byte("aavishield/secretbox/v1\x00" + label + "\x00" + raw))
	return sum[:], nil
}

// Seal encrypts plaintext for storage under label.
func Seal(label, plaintext string) (string, error) {
	k, err := key(label)
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(k)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return prefix + base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plaintext), nil)), nil
}

// Open decrypts what Seal produced. A value without the version prefix is
// treated as legacy plaintext and returned as-is.
func Open(label, sealed string) (string, error) {
	if !strings.HasPrefix(sealed, prefix) {
		return sealed, nil
	}
	k, err := key(label)
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(sealed, prefix))
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(k)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("sealed value too short")
	}
	out, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	return string(out), err
}

func newGCM(k []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(k)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
