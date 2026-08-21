package storage

import "testing"

// Every screenshot key ends in ".webp" (screenshotKey in
// handlers/monitoring_ingest.go), so that must stay the fallback for
// unrecognized/missing extensions — but a key with a real image extension
// (app-catalog icons: .png/.svg/.jpg/.webp/.ico) must get its own type back,
// not a hardcoded one that could make a browser refuse to decode it.
func TestContentTypeForKey(t *testing.T) {
	cases := []struct {
		key  string
		want string
	}{
		{"screenshots/org/emp/2026/01/01/abc.webp", "image/webp"},
		{"app-icons/abc-123.png", "image/png"},
		{"app-icons/abc-123.svg", "image/svg+xml"},
		{"app-icons/abc-123.jpg", "image/jpeg"},
		{"app-icons/abc-123.ico", "image/vnd.microsoft.icon"},
		{"app-icons/no-extension", "image/webp"}, // unknown extension falls back, same as before this change
	}
	for _, tc := range cases {
		if got := contentTypeForKey(tc.key); got != tc.want {
			t.Errorf("contentTypeForKey(%q) = %q, want %q", tc.key, got, tc.want)
		}
	}
}
