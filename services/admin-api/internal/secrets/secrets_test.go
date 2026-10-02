package secrets

import (
	"strings"
	"testing"
)

const strong = "Zq3vN8xK2pL7mR4tW9yB6cF1hJ5sD0gA"

func envOf(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func strongEnv() map[string]string {
	return map[string]string{
		"JWT_ACCESS_SECRET":     strong,
		"CA_KEY_ENCRYPTION_KEY": strong,
		"MEDIA_SIGNING_SECRET":  strong,
		"INTERNAL_API_SECRET":   strong,
		"DLP_SERVICE_URL":       "http://dlp-service:6200",
		"DLP_SERVICE_SECRET":    strong,
		"DATABASE_URL":          "postgres://aavishield:" + strong + "@postgres:6432/aavishield",
		"REDIS_URL":             "redis://:" + strong + "@redis:6379/0",
	}
}

func TestStrongEnvPasses(t *testing.T) {
	if bad := Problems(envOf(strongEnv())); len(bad) != 0 {
		t.Fatalf("expected no problems, got %v", bad)
	}
}

func TestRepoDefaultsAreRejected(t *testing.T) {
	cases := map[string]string{
		"JWT_ACCESS_SECRET":     "aavishield-access-secret-change-in-production",
		"CA_KEY_ENCRYPTION_KEY": "change-this-to-a-long-random-string-in-production",
		"DLP_SERVICE_SECRET":    "dev-insecure-dlp-secret-change-me",
		"INTERNAL_API_SECRET":   "",
		"MEDIA_SIGNING_SECRET":  "short",
	}
	for name, value := range cases {
		env := strongEnv()
		env[name] = value
		bad := Problems(envOf(env))
		if len(bad) != 1 || bad[0] != name {
			t.Errorf("%s=%q: expected [%s], got %v", name, value, name, bad)
		}
	}
}

func TestServiceSecretOnlyRequiredWhenEnabled(t *testing.T) {
	env := strongEnv()
	delete(env, "DLP_SERVICE_URL")
	env["DLP_SERVICE_SECRET"] = ""
	if bad := Problems(envOf(env)); len(bad) != 0 {
		t.Fatalf("disabled service should not need a secret, got %v", bad)
	}
}

func TestDefaultDatabasePasswordIsRejected(t *testing.T) {
	env := strongEnv()
	env["DATABASE_URL"] = "postgres://aavishield:aavishield_dev_password@postgres:6432/aavishield"
	bad := Problems(envOf(env))
	if len(bad) != 1 || !strings.HasPrefix(bad[0], "DATABASE_URL") {
		t.Fatalf("expected DATABASE_URL problem, got %v", bad)
	}
}
