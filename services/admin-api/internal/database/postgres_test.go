package database

import (
	"os"
	"testing"
)

func TestEnvIntFallsBackOnUnset(t *testing.T) {
	os.Unsetenv("TEST_ENV_INT_UNSET")
	if got := envInt("TEST_ENV_INT_UNSET", 42); got != 42 {
		t.Fatalf("expected default 42, got %d", got)
	}
}

func TestEnvIntParsesValidValue(t *testing.T) {
	t.Setenv("TEST_ENV_INT_VALID", "100")
	if got := envInt("TEST_ENV_INT_VALID", 25); got != 100 {
		t.Fatalf("expected 100, got %d", got)
	}
}

func TestEnvIntFallsBackOnUnparseable(t *testing.T) {
	t.Setenv("TEST_ENV_INT_BAD", "not-a-number")
	if got := envInt("TEST_ENV_INT_BAD", 25); got != 25 {
		t.Fatalf("expected fallback 25, got %d", got)
	}
}

// A misconfigured pool size of 0 or negative would silently disable
// connection limiting (database/sql treats <=0 as "unlimited") — this
// must fall back to the default instead of passing a nonsensical value
// through, since "unlimited connections" is exactly the failure mode a
// pool size setting exists to prevent.
func TestEnvIntRejectsZeroAndNegative(t *testing.T) {
	t.Setenv("TEST_ENV_INT_ZERO", "0")
	if got := envInt("TEST_ENV_INT_ZERO", 25); got != 25 {
		t.Fatalf("expected fallback 25 for zero, got %d", got)
	}
	t.Setenv("TEST_ENV_INT_NEG", "-5")
	if got := envInt("TEST_ENV_INT_NEG", 25); got != 25 {
		t.Fatalf("expected fallback 25 for negative, got %d", got)
	}
}
