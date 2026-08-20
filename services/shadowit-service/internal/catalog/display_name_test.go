package catalog

import "testing"

func TestClassifyDisplayName(t *testing.T) {
	c := New()
	for _, tc := range []struct{ in, want string }{
		{"turing-writingassistance.edge.microsoft.com", "Microsoft Edge"},
		{"editor.svc.cloud.microsoft", "Microsoft 365"},
		{"browser.events.data.msn.com", "MSN"},
		{"teams.microsoft.com", "Microsoft Teams"},
		{"mail.google.com", "Gmail"},
		{"drive.google.com", "Google Drive"},
		{"www.dropbox.com", "Dropbox"},
		{"api.some-unknown-vendor.co.uk", "some-unknown-vendor.co.uk"},
		{"a.b.c.unknownthing.com", "unknownthing.com"},
	} {
		if got := c.Classify(tc.in).DisplayName; got != tc.want {
			t.Errorf("Classify(%q).DisplayName = %q, want %q", tc.in, got, tc.want)
		}
	}
}
