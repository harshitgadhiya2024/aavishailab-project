package handlers

import (
	"testing"
	"time"
)

func TestStartOfWeekIsMonday(t *testing.T) {
	loc := time.UTC
	for _, tc := range []struct{ in, want string }{
		{"2026-10-03", "2026-09-28"}, // Saturday
		{"2026-09-28", "2026-09-28"}, // Monday
		{"2026-10-04", "2026-09-28"}, // Sunday
	} {
		in, _ := time.ParseInLocation("2006-01-02", tc.in, loc)
		if got := startOfWeek(in.Add(15 * time.Hour)).Format("2006-01-02"); got != tc.want {
			t.Errorf("startOfWeek(%s) = %s, want %s", tc.in, got, tc.want)
		}
	}
}

func TestNormalizeOS(t *testing.T) {
	for in, want := range map[string]string{"darwin": "macos", "Windows": "windows", "linux": "linux", "": "unknown", "freebsd": "freebsd"} {
		if got := normalizeOS(in); got != want {
			t.Errorf("normalizeOS(%q) = %q, want %q", in, got, want)
		}
	}
}
