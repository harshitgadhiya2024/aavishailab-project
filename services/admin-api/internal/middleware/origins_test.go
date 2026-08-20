package middleware

import (
	"os"
	"testing"
)

func TestOriginAllowedRejectsUnknownOrigin(t *testing.T) {
	old := os.Getenv("CORS_ORIGINS")
	os.Setenv("CORS_ORIGINS", "https://app.example.com")
	defer os.Setenv("CORS_ORIGINS", old)

	// This is the regression this fixes: websocket.go's CheckOrigin used to
	// unconditionally `return true`, letting any site open a WS connection
	// and ride the visitor's session to read their org's live activity feed.
	if OriginAllowed("https://evil.example.net") {
		t.Fatal("an origin not in the allowlist must be rejected")
	}
}

func TestOriginAllowedAcceptsConfiguredOrigin(t *testing.T) {
	old := os.Getenv("CORS_ORIGINS")
	os.Setenv("CORS_ORIGINS", "https://app.example.com,https://admin.example.com")
	defer os.Setenv("CORS_ORIGINS", old)

	if !OriginAllowed("https://app.example.com") {
		t.Fatal("an allowlisted origin must be accepted")
	}
	if !OriginAllowed("https://admin.example.com") {
		t.Fatal("second allowlisted origin must also be accepted")
	}
}

func TestOriginAllowedAcceptsEmptyOriginForNonBrowserClients(t *testing.T) {
	// Native agents and curl don't send an Origin header at all — only
	// browsers do — so an empty Origin must not be treated as untrusted.
	if !OriginAllowed("") {
		t.Fatal("requests with no Origin header (non-browser clients) must be allowed")
	}
}
