package handlers

import "testing"

func TestCountryCode(t *testing.T) {
	for in, want := range map[string]string{
		"IN": "IN", "us": "US", " nl ": "NL",
		"XX": "", "T1": "", "": "", "IND": "", "1A": "",
	} {
		if got := countryCode(in); got != want {
			t.Errorf("countryCode(%q) = %q, want %q", in, got, want)
		}
	}
}
