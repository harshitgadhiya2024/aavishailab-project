package handlers

import "testing"

// A rule stored under a string the agent never matches is worse than no rule
// at all: it looks enforced in the dashboard and silently does nothing. Every
// case here is a shape an admin can actually type into the policy builder.
func TestNormalizePolicyDomain(t *testing.T) {
	cases := map[string]string{
		// The wildcard an admin reaches for. The agent already walks parent
		// domains, so a bare domain covers subdomains — stripping "*." makes
		// the two spellings mean the same thing instead of one of them
		// matching nothing.
		"*.openai.com":               "openai.com",
		"openai.com":                 "openai.com",
		"https://chatgpt.com/":       "chatgpt.com",
		"http://example.com/path?q=1": "example.com",
		"HTTPS://ChatGPT.COM":        "chatgpt.com",
		"example.com:8443":           "example.com",
		"www.facebook.com":           "facebook.com",
		"example.com.":               "example.com",
		"  claude.ai  ":              "claude.ai",
		"user:pass@internal.corp":    "internal.corp",
		"":                           "",
		"   ":                        "",
	}
	for in, want := range cases {
		if got := normalizePolicyDomain(in); got != want {
			t.Errorf("normalizePolicyDomain(%q) = %q, want %q", in, got, want)
		}
	}
}

// "*." and "www." both being stripped must not collapse into a rule that
// blocks something broader than what was typed.
func TestNormalizePolicyDomainDoesNotWidenScope(t *testing.T) {
	if got := normalizePolicyDomain("*.www.example.com"); got != "example.com" {
		t.Errorf("got %q, want example.com", got)
	}
	// A single-label host stays itself rather than becoming empty, so an
	// intranet hostname is still enforceable.
	if got := normalizePolicyDomain("intranet"); got != "intranet" {
		t.Errorf("got %q, want intranet", got)
	}
}

func TestActivitySourceScope(t *testing.T) {
	// Every tab on the Activity page, plus the "All" case.
	for _, name := range []string{"web_gateway", "swg", "dlp", "malware", "download", "application", "app_control", "device_posture", "posture", "device"} {
		if activitySourceScope(name) == nil {
			t.Errorf("activitySourceScope(%q) returned nil — that tab would show every event", name)
		}
	}
	// Unknown and empty both mean "no filter", deliberately — an unrecognised
	// source showing everything beats a tab that renders empty and looks like
	// data loss.
	for _, name := range []string{"", "   ", "not-a-source"} {
		if activitySourceScope(name) != nil {
			t.Errorf("activitySourceScope(%q) should not filter", name)
		}
	}
}

// The DLP and malware tabs must not overlap: a blocked download is download
// protection's event, not the web gateway's.
func TestWebGatewayScopeExcludesOtherSources(t *testing.T) {
	scope := activitySourceScope("web_gateway")
	if scope == nil {
		t.Fatal("web_gateway scope is nil")
	}
	excluded, ok := scope.args[1].([]string)
	if !ok {
		t.Fatalf("expected an exclusion list, got %T", scope.args[1])
	}
	for _, want := range []string{"dlp", "malware", "device_posture", "application_control"} {
		found := false
		for _, e := range excluded {
			if e == want {
				found = true
			}
		}
		if !found {
			t.Errorf("web_gateway scope does not exclude %q — its events would appear under two tabs", want)
		}
	}
}
