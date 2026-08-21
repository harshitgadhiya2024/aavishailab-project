// Package config loads runtime settings from the environment.
package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port          string
	ServiceSecret string
	// ServiceSecretPrevious is optional and only set during a secret
	// rotation window — tokens signed with either secret verify while it's
	// set, so admin-api and this service can be restarted independently
	// without a window where every request 401s.
	ServiceSecretPrevious string
	RequireAuth           bool
	BlockThreshold        int
	AlertThreshold        int
	SyncInterval          time.Duration
	// EnableFeeds turns the background feed sync on. Off in tests so no network
	// is touched; on in production so reputation data stays fresh.
	EnableFeeds bool
}

func Load() Config {
	return Config{
		Port:                  envStr("THREATINTEL_PORT", "6220"),
		ServiceSecret:         envStr("THREATINTEL_SERVICE_SECRET", "dev-insecure-threatintel-secret-change-me"),
		ServiceSecretPrevious: os.Getenv("THREATINTEL_SERVICE_SECRET_PREVIOUS"),
		RequireAuth:           envStr("THREATINTEL_REQUIRE_AUTH", "true") == "true",
		BlockThreshold:        envInt("THREATINTEL_BLOCK_THRESHOLD", 80),
		AlertThreshold:        envInt("THREATINTEL_ALERT_THRESHOLD", 50),
		SyncInterval:          time.Duration(envInt("THREATINTEL_SYNC_HOURS", 6)) * time.Hour,
		EnableFeeds:           envStr("THREATINTEL_ENABLE_FEEDS", "true") == "true",
	}
}

func (c Config) UsingDefaultSecret() bool {
	return c.ServiceSecret == "dev-insecure-threatintel-secret-change-me"
}

func envStr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
