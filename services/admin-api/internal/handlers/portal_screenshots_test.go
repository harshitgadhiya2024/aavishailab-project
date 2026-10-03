package handlers

import "testing"

func TestCleanReason(t *testing.T) {
	cases := map[string]string{
		"  Personal call  ":          "Personal call",
		"line one\nline two":         "line one\nline two",
		"tab\there":                  "tabhere",
		"bell\a and nul\x00 gone":    "bell and nul gone",
		"\r\n  padded \r\n":          "padded",
		"Hindi bhi chalega — सही है": "Hindi bhi chalega — सही है",
	}
	for in, want := range cases {
		if got := cleanReason(in); got != want {
			t.Errorf("cleanReason(%q) = %q, want %q", in, got, want)
		}
	}
}
