// Package secrets refuses to run admin-api in production on a secret that is
// missing or still one of the placeholders from this repo (the code's
// "dev-insecure-…" fallbacks, docker-compose's "change-this-…" defaults). A
// placeholder is public knowledge: with the JWT secret anyone can mint an
// admin token, with the service secrets anyone can talk to the scanners as
// admin-api. Outside production the fallbacks stay, so local dev needs no
// setup.
package secrets

import (
	"log"
	"os"
	"strings"
)

// MinLength is the shortest secret accepted in production —
// `openssl rand -base64 48` gives 64 characters.
const MinLength = 32

// placeholderMarkers are substrings of every default secret this repo ships.
var placeholderMarkers = []string{
	"change-this",
	"change-me",
	"change-in-production",
	"dev-insecure",
	"aavishield-nextauth-secret",
	"aavishield_dev_password",
	"aavishield_redis_dev",
}

// IsPlaceholder reports whether v contains one of the repo's default secrets.
func IsPlaceholder(v string) bool {
	for _, m := range placeholderMarkers {
		if strings.Contains(v, m) {
			return true
		}
	}
	return false
}

// Weak reports whether v is unfit to be a production secret.
func Weak(v string) bool {
	return len(v) < MinLength || IsPlaceholder(v)
}

// alwaysRequired are the secrets admin-api uses on every deployment.
var alwaysRequired = []string{
	"JWT_ACCESS_SECRET",
	"CA_KEY_ENCRYPTION_KEY",
	"MEDIA_SIGNING_SECRET",
	"INTERNAL_API_SECRET",
}

// serviceSecrets maps each scanner's URL variable to the secret admin-api
// signs its requests with; the secret is only required when the URL is set.
var serviceSecrets = map[string]string{
	"DLP_SERVICE_URL":         "DLP_SERVICE_SECRET",
	"MALWARE_SERVICE_URL":     "MALWARE_SERVICE_SECRET",
	"THREATINTEL_SERVICE_URL": "THREATINTEL_SERVICE_SECRET",
	"POSTURE_SERVICE_URL":     "POSTURE_SERVICE_SECRET",
	"SHADOWIT_SERVICE_URL":    "SHADOWIT_SERVICE_SECRET",
	"CASB_SERVICE_URL":        "CASB_SERVICE_SECRET",
}

// connectionStrings embed a password; only the placeholder check applies.
var connectionStrings = []string{"DATABASE_URL", "REDIS_URL"}

// Problems lists every unfit secret by name (never by value) for env.
func Problems(env func(string) string) []string {
	var bad []string
	for _, name := range alwaysRequired {
		if Weak(env(name)) {
			bad = append(bad, name)
		}
	}
	for url, name := range serviceSecrets {
		if env(url) != "" && Weak(env(name)) {
			bad = append(bad, name)
		}
	}
	for _, name := range connectionStrings {
		if IsPlaceholder(env(name)) {
			bad = append(bad, name+" (default password)")
		}
	}
	return bad
}

// MustBeStrongInProduction stops the process when APP_ENV=production and any
// secret is missing, shorter than MinLength, or a repo placeholder.
func MustBeStrongInProduction() {
	if os.Getenv("APP_ENV") != "production" {
		return
	}
	if bad := Problems(os.Getenv); len(bad) > 0 {
		log.Fatalf("secrets: refusing to start in production — missing, shorter than %d characters, or a repo placeholder: %s (generate each with `openssl rand -base64 48`)",
			MinLength, strings.Join(bad, ", "))
	}
}
