package handlers

import (
	"testing"

	"github.com/aavishield/admin-api/internal/models"
)

// SSL Inspection is what lets DLP see an upload at all, and the only way an
// HTTPS block can show the company's own page. Both are required for every
// company now, so an org that has never touched the setting must come back
// enabled — this is the regression guard on that.
func TestSSLInspectionDefaultsOnWhenNeverConfigured(t *testing.T) {
	cases := []struct {
		name     string
		settings map[string]any
		want     bool
	}{
		{"nil settings", nil, true},
		{"empty settings", map[string]any{}, true},
		{"unrelated keys only", map[string]any{"block_page_message": "hi"}, true},

		// An explicit choice is still honoured — this changes what silence
		// means, not what "false" means.
		{"explicitly disabled", map[string]any{"mitm_enabled": false}, false},
		{"explicitly enabled", map[string]any{"mitm_enabled": true}, true},

		// A non-boolean value is a corrupt/hand-edited row. It reads as
		// disabled rather than enabled: the key is present, so somebody
		// intended *something*, and silently decrypting traffic because we
		// could not parse their intent would be the wrong way to be wrong.
		{"non-boolean value", map[string]any{"mitm_enabled": "yes"}, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			org := models.Organization{Settings: tc.settings}
			got, _ := mitmSettingsFromOrg(&org)
			if got != tc.want {
				t.Errorf("mitmSettingsFromOrg(%v) = %v, want %v", tc.settings, got, tc.want)
			}
		})
	}
}

func TestMITMBypassDomainsAreNormalised(t *testing.T) {
	org := models.Organization{Settings: map[string]any{
		"mitm_bypass_domains": []any{"  Bank.COM ", "", "   ", "health.example.org", 42},
	}}
	_, bypass := mitmSettingsFromOrg(&org)

	if len(bypass) != 2 {
		t.Fatalf("got %d bypass domains (%v), want 2 — blanks and non-strings must be dropped", len(bypass), bypass)
	}
	if bypass[0] != "bank.com" {
		t.Errorf("got %q, want lowercased and trimmed 'bank.com'", bypass[0])
	}
}
