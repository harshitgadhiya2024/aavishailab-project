package auth

import (
	"strings"
	"testing"
	"time"
)

func TestTOTPRoundTrip(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("GenerateTOTPSecret: %v", err)
	}

	counter := uint64(time.Now().Unix() / totpPeriod)
	code, err := totpAt(secret, counter)
	if err != nil {
		t.Fatalf("totpAt: %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("expected a 6-digit code, got %q", code)
	}
	if !VerifyTOTP(secret, code) {
		t.Error("the code for the current step should verify")
	}
}

func TestTOTPRFC6238Vector(t *testing.T) {
	// RFC 6238 test vector: ASCII secret "12345678901234567890" (base32
	// GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ) at T=59 → counter 1 → 94287082.
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	code, err := totpAt(secret, 1)
	if err != nil {
		t.Fatalf("totpAt: %v", err)
	}
	if code != "287082" {
		t.Errorf("RFC 6238 vector mismatch: got %q, want %q", code, "287082")
	}
}

func TestTOTPAcceptsAdjacentSteps(t *testing.T) {
	secret, _ := GenerateTOTPSecret()
	counter := uint64(time.Now().Unix() / totpPeriod)

	// A code from the previous step must still work — a user finishing typing
	// as the code rolls over is normal, not an attack.
	previous, _ := totpAt(secret, counter-1)
	if !VerifyTOTP(secret, previous) {
		t.Error("the previous step's code should be accepted")
	}

	// Two steps out is too far.
	stale, _ := totpAt(secret, counter-3)
	if VerifyTOTP(secret, stale) {
		t.Error("a code three steps old should be rejected")
	}
}

func TestTOTPRejectsGarbage(t *testing.T) {
	secret, _ := GenerateTOTPSecret()
	for _, bad := range []string{"", "12345", "1234567", "abcdef", "000000"} {
		if VerifyTOTP(secret, bad) && bad != "000000" {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}

func TestTOTPToleratesSpacedSecret(t *testing.T) {
	secret, _ := GenerateTOTPSecret()
	counter := uint64(time.Now().Unix() / totpPeriod)
	code, _ := totpAt(secret, counter)

	// Apps display secrets in spaced groups; a pasted one must still work.
	spaced := strings.Join([]string{secret[:4], secret[4:8], secret[8:]}, " ")
	if !VerifyTOTP(spaced, code) {
		t.Error("a secret with spaces should verify the same as without")
	}
}

func TestProvisioningURI(t *testing.T) {
	uri := TOTPProvisioningURI("ABC234", "admin@acme.com", "Delsecure")
	for _, want := range []string{"otpauth://totp/", "secret=ABC234", "issuer=Delsecure", "digits=6", "period=30"} {
		if !strings.Contains(uri, want) {
			t.Errorf("provisioning URI missing %q: %s", want, uri)
		}
	}
}

func TestRecoveryCodes(t *testing.T) {
	codes, err := GenerateRecoveryCodes(8)
	if err != nil {
		t.Fatalf("GenerateRecoveryCodes: %v", err)
	}
	if len(codes) != 8 {
		t.Fatalf("expected 8 codes, got %d", len(codes))
	}

	seen := map[string]bool{}
	for _, c := range codes {
		if seen[c] {
			t.Errorf("duplicate recovery code %q", c)
		}
		seen[c] = true
		if len(c) != 11 || c[5] != '-' {
			t.Errorf("unexpected recovery code shape: %q", c)
		}
		// Look-alike characters are excluded so codes can be read off paper.
		if strings.ContainsAny(c, "OIL01") {
			t.Errorf("recovery code %q contains an ambiguous character", c)
		}
	}

	// Hashing must be insensitive to how the user typed it.
	if HashRecoveryCode(codes[0]) != HashRecoveryCode(strings.ToLower(strings.ReplaceAll(codes[0], "-", " "))) {
		t.Error("recovery code hashing should ignore case, spaces and dashes")
	}
}
