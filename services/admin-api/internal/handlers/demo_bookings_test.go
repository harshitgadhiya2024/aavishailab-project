package handlers

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestCheckDemoSlot(t *testing.T) {
	ist, _ := time.LoadLocation(demoTeamZone)
	// Monday 16 Nov 2026, 09:00 IST.
	now := time.Date(2026, 11, 16, 9, 0, 0, 0, ist)
	at := func(day, hour, min int) time.Time { return time.Date(2026, 11, day, hour, min, 0, 0, ist) }
	cases := []struct {
		name string
		slot time.Time
		ok   bool
	}{
		{"first slot tomorrow", at(17, 10, 0), true},
		{"last slot", at(17, 17, 30), true},
		{"half hour", at(17, 14, 30), true},
		{"too soon", at(16, 9, 30), false},
		{"before hours", at(17, 9, 30), false},
		{"after hours", at(17, 18, 0), false},
		{"not on the half hour", at(17, 11, 15), false},
		{"saturday", at(21, 11, 0), false},
		{"more than 30 days out", at(16, 10, 0).AddDate(0, 0, 31), false},
	}
	for _, c := range cases {
		if got := checkDemoSlot(c.slot.UTC(), now); (got == "") != c.ok {
			t.Errorf("%s: got %q, want ok=%v", c.name, got, c.ok)
		}
	}
}

func TestIsUniqueViolation(t *testing.T) {
	if !isUniqueViolation(fmt.Errorf("save: %w", gorm.ErrDuplicatedKey)) {
		t.Error("gorm duplicated key")
	}
	if !isUniqueViolation(errors.New(`ERROR: duplicate key value violates unique constraint "uniq_demo_requests_open_slot" (SQLSTATE 23505)`)) {
		t.Error("postgres message")
	}
	if isUniqueViolation(errors.New("connection refused")) || isUniqueViolation(nil) {
		t.Error("false positive")
	}
}

func TestDemoWhenFallsBackToTeamZone(t *testing.T) {
	slot := time.Date(2026, 11, 17, 4, 30, 0, 0, time.UTC) // 10:00 IST
	if got := demoWhen(slot, ""); got != "Tuesday, 17 November 2026 at 10:00 AM (Asia/Kolkata)" {
		t.Errorf("got %q", got)
	}
	if got := demoWhen(slot, "Europe/London"); got != "Tuesday, 17 November 2026 at 4:30 AM (Europe/London)" {
		t.Errorf("got %q", got)
	}
}
