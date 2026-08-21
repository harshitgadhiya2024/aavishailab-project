package auth

import (
	"testing"
	"time"
)

const (
	currentSecret  = "current-secret-value"
	previousSecret = "previous-secret-value"
	testOrg        = "org-123"
)

func bearer(token string) string { return "Bearer " + token }

func TestVerifyAcceptsTokenSignedWithCurrentSecret(t *testing.T) {
	token := Mint(testOrg, currentSecret, 5*time.Minute)
	if err := Verify(bearer(token), testOrg, currentSecret, previousSecret); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
}

// This is the actual point of the rotation feature: a token minted with the
// secret that was "current" a moment ago must still verify while that
// secret is passed as the second (previous) argument — otherwise rotating
// admin-api's secret before every consumer has picked up the new one would
// 401 every in-flight request.
func TestVerifyAcceptsTokenSignedWithPreviousSecret(t *testing.T) {
	token := Mint(testOrg, previousSecret, 5*time.Minute)
	if err := Verify(bearer(token), testOrg, currentSecret, previousSecret); err != nil {
		t.Fatalf("token signed with the previous secret must still verify during rotation: %v", err)
	}
}

func TestVerifyRejectsTokenSignedWithNeitherSecret(t *testing.T) {
	token := Mint(testOrg, "some-other-secret-entirely", 5*time.Minute)
	if err := Verify(bearer(token), testOrg, currentSecret, previousSecret); err != ErrSignature {
		t.Fatalf("expected ErrSignature, got %v", err)
	}
}

// An empty ServiceSecretPrevious (the common case — no rotation in
// progress) must be skipped, not treated as a valid empty-string secret
// that any zero-length signature could match against.
func TestVerifyIgnoresEmptyPreviousSecret(t *testing.T) {
	token := Mint(testOrg, currentSecret, 5*time.Minute)
	if err := Verify(bearer(token), testOrg, currentSecret, ""); err != nil {
		t.Fatalf("expected success with empty previous secret ignored, got %v", err)
	}

	badToken := Mint(testOrg, "", 5*time.Minute)
	if err := Verify(bearer(badToken), testOrg, currentSecret, ""); err != ErrSignature {
		t.Fatalf("a token signed with an empty secret must not verify just because previous secret is also empty, got %v", err)
	}
}

func TestVerifyRejectsExpiredToken(t *testing.T) {
	token := Mint(testOrg, currentSecret, -1*time.Minute)
	if err := Verify(bearer(token), testOrg, currentSecret); err != ErrExpired {
		t.Fatalf("expected ErrExpired, got %v", err)
	}
}

func TestVerifyRejectsOrgMismatch(t *testing.T) {
	token := Mint(testOrg, currentSecret, 5*time.Minute)
	if err := Verify(bearer(token), "a-different-org", currentSecret); err != ErrOrg {
		t.Fatalf("expected ErrOrg, got %v", err)
	}
}

func TestVerifyRejectsMissingBearerPrefix(t *testing.T) {
	if err := Verify("not-a-bearer-token", testOrg, currentSecret); err != ErrMissing {
		t.Fatalf("expected ErrMissing, got %v", err)
	}
}

func TestVerifyRejectsMalformedToken(t *testing.T) {
	if err := Verify(bearer("v1.onlyonepart"), testOrg, currentSecret); err != ErrMalformed {
		t.Fatalf("expected ErrMalformed, got %v", err)
	}
	if err := Verify(bearer("v2.a.b"), testOrg, currentSecret); err != ErrMalformed {
		t.Fatalf("expected ErrMalformed for a non-v1 token, got %v", err)
	}
}

func TestVerifyWorksWithASingleSecretArgumentForBackwardCompatibility(t *testing.T) {
	// Existing call sites (pre-rotation) passed exactly one secret — the
	// variadic signature must not break that call shape.
	token := Mint(testOrg, currentSecret, 5*time.Minute)
	if err := Verify(bearer(token), testOrg, currentSecret); err != nil {
		t.Fatalf("expected success with a single secret argument, got %v", err)
	}
}
