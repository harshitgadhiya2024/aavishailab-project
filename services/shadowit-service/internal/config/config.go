// Package config loads runtime settings from the environment.
package config

import "os"

type Config struct {
	Port          string
	ServiceSecret string
	RequireAuth   bool
	// CatalogFile, when set, is a JSON file that extends/overrides the built-in
	// cloud-app catalog (domain -> {app, category, risk_score}). Lets ops grow
	// coverage toward a Zscaler-sized app DB without a code change.
	CatalogFile string
}

func Load() Config {
	return Config{
		Port:          env("SHADOWIT_PORT", "6240"),
		ServiceSecret: env("SHADOWIT_SERVICE_SECRET", "dev-insecure-shadowit-secret-change-me"),
		RequireAuth:   env("SHADOWIT_REQUIRE_AUTH", "true") == "true",
		CatalogFile:   os.Getenv("SHADOWIT_CATALOG_FILE"),
	}
}

func (c Config) UsingDefaultSecret() bool {
	return c.ServiceSecret == "dev-insecure-shadowit-secret-change-me"
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
