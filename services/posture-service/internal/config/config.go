// Package config loads runtime settings from the environment.
package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port           string
	ServiceSecret  string
	RequireAuth    bool
	PassThreshold  int
	WarnThreshold  int
	// GeoIPCSV, when set, points at a CIDR/range country CSV
	// (lines: startIP,endIP,countryCode,countryName) used to resolve IPs to
	// countries. Unset -> only private/reserved detection works and public IPs
	// resolve to "unknown" (a free db-ip.com / ip2location LITE country CSV
	// mounted here upgrades that to full country resolution).
	GeoIPCSV string
}

func Load() Config {
	return Config{
		Port:          envStr("POSTURE_PORT", "6230"),
		ServiceSecret: envStr("POSTURE_SERVICE_SECRET", "dev-insecure-posture-secret-change-me"),
		RequireAuth:   envStr("POSTURE_REQUIRE_AUTH", "true") == "true",
		PassThreshold: envInt("POSTURE_PASS_THRESHOLD", 80),
		WarnThreshold: envInt("POSTURE_WARN_THRESHOLD", 50),
		GeoIPCSV:      os.Getenv("POSTURE_GEOIP_CSV"),
	}
}

func (c Config) UsingDefaultSecret() bool {
	return c.ServiceSecret == "dev-insecure-posture-secret-change-me"
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
