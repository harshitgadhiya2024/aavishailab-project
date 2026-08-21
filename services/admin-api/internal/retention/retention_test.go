package retention

import "testing"

func TestDaysFromSettingsUsesDefaultsWhenEmpty(t *testing.T) {
	activity, audit := daysFromSettings(map[string]any{})
	if activity != defaultActivityDays || audit != defaultAuditDays {
		t.Fatalf("expected defaults (%d, %d), got (%d, %d)", defaultActivityDays, defaultAuditDays, activity, audit)
	}
}

func TestDaysFromSettingsReadsConfiguredValues(t *testing.T) {
	// json.Unmarshal into map[string]any always produces float64 for numbers
	// — this is the shape PlatformSetting.Value actually carries at runtime.
	activity, audit := daysFromSettings(map[string]any{
		"activity_log_days": float64(30),
		"audit_log_days":    float64(90),
	})
	if activity != 30 || audit != 90 {
		t.Fatalf("expected (30, 90), got (%d, %d)", activity, audit)
	}
}

func TestDaysFromSettingsRejectsZeroAndNegative(t *testing.T) {
	// A misconfigured 0 or negative value must never turn into "delete
	// everything right now" — fall back to the safe default instead.
	activity, audit := daysFromSettings(map[string]any{
		"activity_log_days": float64(0),
		"audit_log_days":    float64(-5),
	})
	if activity != defaultActivityDays || audit != defaultAuditDays {
		t.Fatalf("expected defaults on invalid input, got (%d, %d)", activity, audit)
	}
}

func TestDaysFromSettingsIgnoresWrongType(t *testing.T) {
	activity, audit := daysFromSettings(map[string]any{
		"activity_log_days": "thirty",
		"audit_log_days":    nil,
	})
	if activity != defaultActivityDays || audit != defaultAuditDays {
		t.Fatalf("expected defaults on wrong type, got (%d, %d)", activity, audit)
	}
}
