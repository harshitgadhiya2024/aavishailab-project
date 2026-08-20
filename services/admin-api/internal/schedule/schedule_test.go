package schedule

import (
	"testing"
	"time"
)

func kolkata(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		t.Fatalf("load Asia/Kolkata: %v", err)
	}
	return loc
}

func weekdaySpec() *Spec {
	windows := []Window{}
	for d := 1; d <= 5; d++ { // Mon–Fri
		windows = append(windows, Window{Day: d, Start: "10:00", End: "19:00"})
	}
	return &Spec{
		Timezone: "Asia/Kolkata", Windows: windows,
		OffHoursMode: OffHoursFullPause, Enabled: true, Source: "org",
	}
}

func TestNoScheduleAlwaysEnforces(t *testing.T) {
	// The company-laptop case, and the safe default for a half-configured
	// schedule: never silently stop monitoring.
	for name, spec := range map[string]*Spec{
		"nil":            nil,
		"disabled":       {Enabled: false, Windows: []Window{{Day: 1, Start: "10:00", End: "19:00"}}},
		"no windows":     {Enabled: true},
		"enabled+3amSun": nil,
	} {
		st := Evaluate(spec, time.Date(2026, 8, 2, 3, 0, 0, 0, time.UTC))
		if !st.Active || st.Mode != "full" {
			t.Errorf("%s: expected always-on, got active=%v mode=%s", name, st.Active, st.Mode)
		}
	}
}

func TestInsideAndOutsideWindow(t *testing.T) {
	loc := kolkata(t)
	spec := weekdaySpec()

	cases := []struct {
		name   string
		at     time.Time
		active bool
	}{
		{"Monday 11:00 — working", time.Date(2026, 8, 3, 11, 0, 0, 0, loc), true},
		{"Monday 09:59 — before start", time.Date(2026, 8, 3, 9, 59, 0, 0, loc), false},
		{"Monday 10:00 — boundary is inclusive", time.Date(2026, 8, 3, 10, 0, 0, 0, loc), true},
		{"Monday 18:59 — last minute", time.Date(2026, 8, 3, 18, 59, 0, 0, loc), true},
		{"Monday 19:00 — end is exclusive", time.Date(2026, 8, 3, 19, 0, 0, 0, loc), false},
		{"Saturday noon — weekend", time.Date(2026, 8, 8, 12, 0, 0, 0, loc), false},
		{"Sunday noon — weekend", time.Date(2026, 8, 9, 12, 0, 0, 0, loc), false},
	}
	for _, tc := range cases {
		if got := Evaluate(spec, tc.at); got.Active != tc.active {
			t.Errorf("%s: active = %v, want %v (%s)", tc.name, got.Active, tc.active, got.Reason)
		}
	}
}

func TestTimezoneIsTheSchedulesNotTheDevices(t *testing.T) {
	// 11:00 in Kolkata is 05:30 UTC. Evaluating the same instant must give the
	// same answer whichever zone the caller's clock happens to be in —
	// otherwise a laptop set to another timezone would fall out of hours.
	loc := kolkata(t)
	instant := time.Date(2026, 8, 3, 11, 0, 0, 0, loc)
	spec := weekdaySpec()

	if !Evaluate(spec, instant).Active {
		t.Fatal("expected enforcing at 11:00 Kolkata")
	}
	if !Evaluate(spec, instant.UTC()).Active {
		t.Error("same instant expressed in UTC should give the same answer")
	}
	if !Evaluate(spec, instant.In(time.FixedZone("UTC-8", -8*3600))).Active {
		t.Error("same instant expressed in UTC-8 should give the same answer")
	}
}

func TestUntilReportsEndOfWindow(t *testing.T) {
	loc := kolkata(t)
	st := Evaluate(weekdaySpec(), time.Date(2026, 8, 3, 11, 0, 0, 0, loc))
	if st.Until == nil {
		t.Fatal("expected an end instant while enforcing")
	}
	want := time.Date(2026, 8, 3, 19, 0, 0, 0, loc)
	if !st.Until.Equal(want) {
		t.Errorf("until = %s, want %s", st.Until.In(loc), want)
	}
}

func TestUntilReportsNextStartWhilePaused(t *testing.T) {
	loc := kolkata(t)
	// Friday evening: the next window is Monday morning, not tomorrow.
	st := Evaluate(weekdaySpec(), time.Date(2026, 8, 7, 20, 0, 0, 0, loc))
	if st.Active {
		t.Fatal("Friday 20:00 should be outside working hours")
	}
	if st.Until == nil {
		t.Fatal("expected the next resume instant")
	}
	want := time.Date(2026, 8, 10, 10, 0, 0, 0, loc) // Monday
	if !st.Until.Equal(want) {
		t.Errorf("resumes at %s, want %s", st.Until.In(loc), want)
	}
}

func TestAdjacentWindowsMergeIntoOneUntil(t *testing.T) {
	loc := kolkata(t)
	spec := &Spec{
		Timezone: "Asia/Kolkata", Enabled: true, OffHoursMode: OffHoursFullPause,
		Windows: []Window{
			{Day: 1, Start: "09:00", End: "13:00"},
			{Day: 1, Start: "13:00", End: "18:00"},
		},
	}
	st := Evaluate(spec, time.Date(2026, 8, 3, 10, 0, 0, 0, loc))
	if !st.Active {
		t.Fatal("expected enforcing")
	}
	want := time.Date(2026, 8, 3, 18, 0, 0, 0, loc)
	if st.Until == nil || !st.Until.Equal(want) {
		t.Errorf("until = %v, want %s — touching windows must merge", st.Until, want)
	}
}

func TestOvernightWindowCrossesMidnight(t *testing.T) {
	loc := kolkata(t)
	spec := &Spec{
		Timezone: "Asia/Kolkata", Enabled: true, OffHoursMode: OffHoursFullPause,
		Windows:  []Window{{Day: 1, Start: "22:00", End: "06:00"}}, // Mon night → Tue morning
	}
	if !Evaluate(spec, time.Date(2026, 8, 3, 23, 30, 0, 0, loc)).Active {
		t.Error("Monday 23:30 should be inside a 22:00–06:00 window")
	}
	if !Evaluate(spec, time.Date(2026, 8, 4, 5, 30, 0, 0, loc)).Active {
		t.Error("Tuesday 05:30 should still be inside Monday's overnight window")
	}
	if Evaluate(spec, time.Date(2026, 8, 4, 6, 30, 0, 0, loc)).Active {
		t.Error("Tuesday 06:30 is past the window")
	}
}

func TestHolidaySuppressesTheDay(t *testing.T) {
	loc := kolkata(t)
	spec := weekdaySpec()
	spec.Holidays = []string{"2026-08-03"} // a Monday

	if Evaluate(spec, time.Date(2026, 8, 3, 11, 0, 0, 0, loc)).Active {
		t.Error("a holiday should suppress that day's windows")
	}
	if !Evaluate(spec, time.Date(2026, 8, 4, 11, 0, 0, 0, loc)).Active {
		t.Error("the following day is unaffected")
	}
}

func TestSecurityOnlyModeReported(t *testing.T) {
	spec := weekdaySpec()
	spec.OffHoursMode = OffHoursSecurityOnly
	loc := kolkata(t)

	st := Evaluate(spec, time.Date(2026, 8, 8, 12, 0, 0, 0, loc)) // Saturday
	if st.Active {
		t.Fatal("Saturday is outside working hours")
	}
	if st.Mode != "security_only" {
		t.Errorf("mode = %q, want security_only", st.Mode)
	}
}

func TestDSTTransitionKeepsLocalWorkingDay(t *testing.T) {
	// New York moves to DST on 8 March 2026. 10:00–19:00 local must remain
	// 10:00–19:00 local on both sides, which only holds because intervals are
	// built with time.Date in the zone rather than by adding fixed offsets.
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("tzdata unavailable")
	}
	spec := weekdaySpec()
	spec.Timezone = "America/New_York"

	before := time.Date(2026, 3, 6, 11, 0, 0, 0, loc) // Friday before the shift
	after := time.Date(2026, 3, 9, 11, 0, 0, 0, loc)  // Monday after it
	if !Evaluate(spec, before).Active || !Evaluate(spec, after).Active {
		t.Error("11:00 local is a working hour on both sides of the DST change")
	}
	st := Evaluate(spec, after)
	if st.Until == nil || st.Until.In(loc).Hour() != 19 {
		t.Errorf("window should still end at 19:00 local, got %v", st.Until)
	}
}

func TestValidate(t *testing.T) {
	good := []Window{{Day: 1, Start: "10:00", End: "19:00"}}
	if err := Validate("Asia/Kolkata", good, []string{"2026-08-15"}); err != nil {
		t.Errorf("valid schedule rejected: %v", err)
	}
	for name, fn := range map[string]func() error{
		"bad timezone": func() error { return Validate("Mars/Olympus", good, nil) },
		"no windows":   func() error { return Validate("UTC", nil, nil) },
		"bad day":      func() error { return Validate("UTC", []Window{{Day: 9, Start: "10:00", End: "19:00"}}, nil) },
		"bad time":     func() error { return Validate("UTC", []Window{{Day: 1, Start: "25:00", End: "19:00"}}, nil) },
		"bad holiday":  func() error { return Validate("UTC", good, []string{"15-08-2026"}) },
	} {
		if err := fn(); err == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
}
