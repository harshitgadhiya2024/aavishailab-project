package lifecycle

import (
	"testing"
	"time"
)

var t0 = time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)

func TestTrialStep(t *testing.T) {
	h := time.Hour
	cases := []struct {
		name           string
		left           time.Duration
		sent3d, sent1d bool
		want           string
	}{
		{"plenty left", 5 * 24 * h, false, false, ""},
		{"three days", 70 * h, false, false, "3d"},
		{"three days already sent", 70 * h, true, false, ""},
		{"last day", 20 * h, true, false, "1d"},
		{"last day, 3d never sent", 20 * h, false, false, "1d"},
		{"last day already sent", 20 * h, true, true, ""},
		{"no 3d after 1d", 50 * h, false, true, ""},
		{"ended", -time.Minute, true, true, "expire"},
		{"ended exactly now", 0, false, false, "expire"},
	}
	for _, c := range cases {
		if got := TrialStep(t0, t0.Add(c.left), c.sent3d, c.sent1d); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

func TestDemoReminderDue(t *testing.T) {
	h := time.Hour
	booked3dAgo := t0.Add(-72 * h)
	cases := []struct {
		name      string
		until     time.Duration
		createdAt time.Time
		s24, s1   bool
		want      string
	}{
		{"two days out", 48 * h, booked3dAgo, false, false, ""},
		{"day before", 20 * h, booked3dAgo, false, false, "24h"},
		{"day before, sent", 20 * h, booked3dAgo, true, false, ""},
		{"booked same day: no day-before mail", 20 * h, t0.Add(-h), false, false, ""},
		{"hour before", 50 * time.Minute, booked3dAgo, true, false, "1h"},
		{"hour before even if 24h skipped", 50 * time.Minute, t0.Add(-2 * h), false, false, "1h"},
		{"hour before, sent", 50 * time.Minute, booked3dAgo, true, true, ""},
		{"already started", -time.Minute, booked3dAgo, false, false, ""},
	}
	for _, c := range cases {
		if got := DemoReminderDue(t0, t0.Add(c.until), c.createdAt, c.s24, c.s1); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

func TestRenewalStep(t *testing.T) {
	d := 24 * time.Hour
	paid := t0.Add(5 * d)
	key := paid.UTC().Format(time.RFC3339)
	if got := RenewalStep(t0, t0.Add(30*d), "", false); got != "" {
		t.Errorf("a month out: %q", got)
	}
	if got := RenewalStep(t0, paid, "", false); got != "invoice" {
		t.Errorf("within lead: %q", got)
	}
	if got := RenewalStep(t0, paid, key, false); got != "" {
		t.Errorf("already invoiced: %q", got)
	}
	lapsedAt := t0.Add(-3 * d)
	if got := RenewalStep(t0, lapsedAt, lapsedAt.UTC().Format(time.RFC3339), false); got != "" {
		t.Errorf("inside grace, invoiced: %q", got)
	}
	if got := RenewalStep(t0, lapsedAt, "", false); got != "invoice" {
		t.Errorf("inside grace, never invoiced: %q", got)
	}
	if got := RenewalStep(t0, t0.Add(-8*d), "", false); got != "lapse" {
		t.Errorf("past grace: %q", got)
	}
	if got := RenewalStep(t0, t0.Add(-8*d), "", true); got != "" {
		t.Errorf("renewal paid: %q", got)
	}
}
