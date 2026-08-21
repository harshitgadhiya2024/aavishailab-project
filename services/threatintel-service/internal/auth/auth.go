// Package auth verifies the org-bound HMAC service token admin-api mints (same
// scheme as dlp/malware services; separate secret). Stdlib only.
//
// Token: v1.<b64url(payload)>.<b64url(hmac_sha256(payload, secret))>
//
//	payload = {"iss":"admin-api","org_id":"<uuid>","exp":<unix>}
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	ErrMissing   = errors.New("missing bearer token")
	ErrMalformed = errors.New("malformed token")
	ErrSignature = errors.New("bad signature")
	ErrExpired   = errors.New("token expired")
	ErrOrg       = errors.New("token org mismatch")
)

// Mint builds a token (used by tests; admin-api has its own minter).
func Mint(orgID, secret string, ttl time.Duration) string {
	payload, _ := json.Marshal(map[string]any{
		"iss":    "admin-api",
		"org_id": orgID,
		"exp":    time.Now().Add(ttl).Unix(),
	})
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	enc := base64.RawURLEncoding
	return "v1." + enc.EncodeToString(payload) + "." + enc.EncodeToString(mac.Sum(nil))
}

// Verify checks the bearer token's signature, expiry, and org binding.
// Accepts one or more candidate secrets — pass both the current and a
// still-valid previous secret during a rotation window, so a token minted
// moments before admin-api picked up the new secret doesn't fail every
// service that hasn't rotated yet. An empty string (an unset "previous"
// secret) is skipped rather than treated as a valid empty secret.
func Verify(authHeader, expectedOrg string, secrets ...string) error {
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return ErrMissing
	}
	token := strings.TrimSpace(authHeader[len("Bearer "):])
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return ErrMalformed
	}
	enc := base64.RawURLEncoding
	payload, err := enc.DecodeString(parts[1])
	if err != nil {
		return ErrMalformed
	}
	providedSig, err := enc.DecodeString(parts[2])
	if err != nil {
		return ErrMalformed
	}
	matched := false
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(payload)
		if hmac.Equal(providedSig, mac.Sum(nil)) {
			matched = true
			break
		}
	}
	if !matched {
		return ErrSignature
	}
	var claims struct {
		OrgID string `json:"org_id"`
		Exp   int64  `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ErrMalformed
	}
	if claims.Exp < time.Now().Unix() {
		return ErrExpired
	}
	if claims.OrgID != expectedOrg {
		return ErrOrg
	}
	return nil
}
