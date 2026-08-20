package dlpclient

import (
	"os"
	"strings"
	"testing"
	"time"
)

// TestMintTokenFormat verifies the service token is well-formed (v1.<b64>.<b64>).
// When CROSSLANG_TOKEN_FILE is set it also writes the token out, so a companion
// script can confirm the Python dlp-service verifies exactly what Go mints —
// the critical cross-language seam between the two services.
func TestMintTokenFormat(t *testing.T) {
	os.Setenv("DLP_SERVICE_SECRET", "cross-lang-secret-xyz")
	tok := MintToken("11111111-1111-1111-1111-111111111111", 5*time.Minute)

	parts := strings.Split(tok, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		t.Fatalf("malformed token: %q", tok)
	}
	for _, p := range parts[1:] {
		if p == "" {
			t.Fatalf("empty token segment in %q", tok)
		}
	}

	if out := os.Getenv("CROSSLANG_TOKEN_FILE"); out != "" {
		if err := os.WriteFile(out, []byte(tok), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEnabledReflectsEnv(t *testing.T) {
	os.Unsetenv("DLP_SERVICE_URL")
	if Enabled() {
		t.Fatal("Enabled() should be false when DLP_SERVICE_URL is unset")
	}
	os.Setenv("DLP_SERVICE_URL", "http://dlp-service:6200")
	defer os.Unsetenv("DLP_SERVICE_URL")
	if !Enabled() {
		t.Fatal("Enabled() should be true when DLP_SERVICE_URL is set")
	}
}
