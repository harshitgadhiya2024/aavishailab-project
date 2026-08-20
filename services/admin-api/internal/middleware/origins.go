package middleware

import (
	"os"
	"strings"
)

// AllowedOrigins is the single source of truth for which frontend origins
// this API trusts — used for both the HTTP CORS policy (router.go) and the
// WebSocket upgrade's Origin check (websocket.go), which previously
// accepted any origin unconditionally.
func AllowedOrigins() []string {
	raw := strings.Split(os.Getenv("CORS_ORIGINS"), ",")
	origins := make([]string, 0, len(raw))
	for _, o := range raw {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}
	if len(origins) == 0 {
		origins = []string{
			"http://localhost:1001",
			"http://localhost:1002",
			"http://localhost:1003",
			"https://aavishield-admin.aavishailab.com",
			"https://aavishield-app.aavishailab.com",
			"https://aavishield-employee.aavishailab.com",
		}
	}
	return origins
}

// OriginAllowed reports whether origin exactly matches one of AllowedOrigins.
func OriginAllowed(origin string) bool {
	if origin == "" {
		// Same-origin requests (curl, native agents) don't send an Origin
		// header at all — only browsers do, and only browsers need this
		// check enforced.
		return true
	}
	for _, o := range AllowedOrigins() {
		if o == origin {
			return true
		}
	}
	return false
}
