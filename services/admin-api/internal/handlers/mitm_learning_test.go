package handlers

import "testing"

func TestRegistrableDomain(t *testing.T) {
	cases := map[string]string{
		"my.parallels.com":           "parallels.com",
		"parallels.com":              "parallels.com",
		"a.b.example.co.uk":          "example.co.uk",
		"files.company.com.au":       "company.com.au",
		"login.microsoftonline.com.": "microsoftonline.com",
		"localhost":                  "localhost",
	}
	for in, want := range cases {
		if got := registrableDomain(in); got != want {
			t.Errorf("registrableDomain(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDLPRelevantByBuiltInList(t *testing.T) {
	for _, host := range []string{"files.slack.com", "teams.microsoft.com", "uploads.github.com", "drive.google.com", "chatgpt.com"} {
		found := false
		for _, s := range append(domainSuffixes(host), registrableDomain(host)) {
			if dlpRelevantDomains[s] {
				found = true
			}
		}
		if !found {
			t.Errorf("%s must count as a place data can leave the company", host)
		}
	}
	for _, s := range append(domainSuffixes("my.parallels.com"), "parallels.com") {
		if dlpRelevantDomains[s] {
			t.Errorf("parallels.com is not a DLP destination")
		}
	}
}
