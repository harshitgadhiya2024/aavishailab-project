// Package policysig signs the policy bundles GetRules serves to endpoint
// agents, so an agent can prove a bundle is genuine rather than trusting
// "it arrived over an authenticated connection" alone — a transport-level
// guarantee that says nothing about whether the bytes were altered between
// the database and the device.
//
// Deliberately asymmetric (Ed25519), not the shared-HMAC-secret pattern
// used for service-to-service auth elsewhere in this codebase. That
// pattern is fine between a handful of trusted backend services, but
// wrong here: potentially thousands of endpoint devices need to verify a
// signature, and if verification used the same secret that signs
// (symmetric HMAC), any single reverse-engineered device would leak the
// ability to forge policy for the entire fleet. Only the public half of
// this keypair ever leaves the server — see PublicKeyBase64.
package policysig

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"log"
	"os"
)

type Signer struct {
	private ed25519.PrivateKey
	public  ed25519.PublicKey
	keyID   string
}

// New loads the signing keypair from POLICY_SIGNING_KEY (base64-encoded
// 32-byte Ed25519 seed). Refuses to start in production without one —
// policy bundles would otherwise ship unsigned, silently dropping the
// integrity guarantee this package exists to provide. Outside production,
// generates an ephemeral key so local development works with zero setup;
// this logs loudly since it means every restart re-keys and agents that
// pinned the previous public key will need to re-fetch it.
func New() *Signer {
	seedB64 := os.Getenv("POLICY_SIGNING_KEY")
	var seed []byte

	if seedB64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(seedB64)
		if err != nil || len(decoded) != ed25519.SeedSize {
			log.Fatalf("policysig: POLICY_SIGNING_KEY is set but is not a valid base64-encoded %d-byte Ed25519 seed", ed25519.SeedSize)
		}
		seed = decoded
	} else {
		if os.Getenv("APP_ENV") == "production" {
			log.Fatal("policysig: POLICY_SIGNING_KEY must be set in production — policy bundles would otherwise ship unsigned")
		}
		log.Println("policysig: WARNING — POLICY_SIGNING_KEY not set, generating an ephemeral dev-only signing key (changes every restart)")
		seed = make([]byte, ed25519.SeedSize)
		if _, err := rand.Read(seed); err != nil {
			log.Fatalf("policysig: could not generate ephemeral signing key: %v", err)
		}
	}

	priv := ed25519.NewKeyFromSeed(seed)
	pub := priv.Public().(ed25519.PublicKey)
	sum := sha256.Sum256(pub)
	return &Signer{private: priv, public: pub, keyID: hex.EncodeToString(sum[:8])}
}

// Sign returns a base64-encoded Ed25519 signature over body.
func (s *Signer) Sign(body []byte) string {
	return base64.StdEncoding.EncodeToString(ed25519.Sign(s.private, body))
}

// KeyID is a short, stable fingerprint of the public key — lets an agent
// (and a future key-rotation flow) tell which key a signature was made
// with without shipping the full 32-byte key in every response header.
func (s *Signer) KeyID() string { return s.keyID }

// PublicKeyBase64 is the only half of the keypair ever served to a caller —
// see /internal/agent/policy-public-key.
func (s *Signer) PublicKeyBase64() string {
	return base64.StdEncoding.EncodeToString(s.public)
}
