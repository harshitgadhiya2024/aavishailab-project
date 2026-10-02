package authpolicy

import "testing"

func TestValidatePassword(t *testing.T) {
	bad := map[string]string{
		"short1!":         "too short",
		"onlylowercase": "no class mix, 13 chars <14",
		"Admin@1234":      "common",
		"password@1":      "common",
		"riya@delphic.io": "contains email local part",
	}
	for pw, why := range bad {
		if ValidatePassword(pw, "riya@delphic.io") == "" {
			t.Errorf("expected %q to be rejected (%s)", pw, why)
		}
	}
	good := []string{
		"Tr0ub4dour&3xplore",
		"correct horse battery staple river", // long passphrase, <3 classes OK
		"Gx7!muntazirQ",
	}
	for _, pw := range good {
		if r := ValidatePassword(pw, "someone@example.com"); r != "" {
			t.Errorf("expected %q to pass, got %q", pw, r)
		}
	}
}
