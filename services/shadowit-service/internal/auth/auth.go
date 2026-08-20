// Package auth verifies the org-bound HMAC service token admin-api mints.
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

func Mint(orgID, secret string, ttl time.Duration) string {
	payload, _ := json.Marshal(map[string]any{
		"iss": "admin-api", "org_id": orgID, "exp": time.Now().Add(ttl).Unix(),
	})
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	enc := base64.RawURLEncoding
	return "v1." + enc.EncodeToString(payload) + "." + enc.EncodeToString(mac.Sum(nil))
}

func Verify(authHeader, expectedOrg, secret string) error {
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return ErrMissing
	}
	parts := strings.Split(strings.TrimSpace(authHeader[len("Bearer "):]), ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return ErrMalformed
	}
	enc := base64.RawURLEncoding
	payload, err := enc.DecodeString(parts[1])
	if err != nil {
		return ErrMalformed
	}
	sig, err := enc.DecodeString(parts[2])
	if err != nil {
		return ErrMalformed
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
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
