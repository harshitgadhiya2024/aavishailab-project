package secretbox

import (
	"strings"
	"testing"
)

func TestSealOpen(t *testing.T) {
	t.Setenv("CA_KEY_ENCRYPTION_KEY", "unit-test-key-0123456789abcdefghijklmnop")
	sealed, err := Seal("mfa-totp", "JBSWY3DPEHPK3PXP")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "JBSWY3DPEHPK3PXP") || !strings.HasPrefix(sealed, "v1:") {
		t.Fatalf("ciphertext leaks or unversioned: %q", sealed)
	}
	got, err := Open("mfa-totp", sealed)
	if err != nil || got != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("round trip = %q, %v", got, err)
	}
	// Wrong label (different derived key) must not open it.
	if _, err := Open("other", sealed); err == nil {
		t.Fatal("opened under the wrong label")
	}
	// Legacy plaintext passes through unchanged.
	if got, _ := Open("mfa-totp", "PLAINTEXTSECRET"); got != "PLAINTEXTSECRET" {
		t.Fatalf("legacy passthrough = %q", got)
	}
}
