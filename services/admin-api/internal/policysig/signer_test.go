package policysig

import (
	"crypto/ed25519"
	"encoding/base64"
	"testing"
)

func devSigner(t *testing.T) *Signer {
	t.Helper()
	t.Setenv("POLICY_SIGNING_KEY", "")
	t.Setenv("APP_ENV", "development")
	return New()
}

func TestSignatureVerifiesWithThePublicKey(t *testing.T) {
	s := devSigner(t)
	body := []byte(`{"rules":[{"domain":"example.com","action":"block"}]}`)

	sig, err := base64.StdEncoding.DecodeString(s.Sign(body))
	if err != nil {
		t.Fatalf("signature is not valid base64: %v", err)
	}
	pub, err := base64.StdEncoding.DecodeString(s.PublicKeyBase64())
	if err != nil {
		t.Fatalf("public key is not valid base64: %v", err)
	}
	if !ed25519.Verify(pub, body, sig) {
		t.Fatal("signature does not verify against the signer's own public key")
	}
}

func TestSignatureRejectsTamperedBody(t *testing.T) {
	s := devSigner(t)
	body := []byte(`{"rules":[{"domain":"example.com","action":"allow"}]}`)
	sig, _ := base64.StdEncoding.DecodeString(s.Sign(body))
	pub, _ := base64.StdEncoding.DecodeString(s.PublicKeyBase64())

	tampered := []byte(`{"rules":[{"domain":"example.com","action":"block"}]}`)
	if ed25519.Verify(pub, tampered, sig) {
		t.Fatal("signature verified against a body it was never signed over")
	}
}

func TestKeyIDIsStableAcrossCalls(t *testing.T) {
	s := devSigner(t)
	id1 := s.KeyID()
	id2 := s.KeyID()
	if id1 != id2 || id1 == "" {
		t.Fatalf("KeyID not stable: %q vs %q", id1, id2)
	}
}

// A fixed, real seed round-trips deterministically — catches any accidental
// change to seed handling (e.g. swapping NewKeyFromSeed's expected format)
// that unit tests using random seeds every run wouldn't reliably surface.
func TestLoadsAFixedSeedDeterministically(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize) // all-zero seed — deterministic, test-only
	t.Setenv("POLICY_SIGNING_KEY", base64.StdEncoding.EncodeToString(seed))
	s := New()

	want := ed25519.NewKeyFromSeed(seed)
	wantPub := want.Public().(ed25519.PublicKey)
	if s.PublicKeyBase64() != base64.StdEncoding.EncodeToString(wantPub) {
		t.Fatal("loaded public key does not match the expected key for this fixed seed")
	}
}
