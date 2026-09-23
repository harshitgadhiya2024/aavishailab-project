package handlers

import (
	"testing"

	"github.com/aavishield/admin-api/internal/models"
)

// "Allowed" is routine, ordinary traffic — every one of the hundreds of
// ordinary requests a workday produces. It is never shown anywhere on the
// dashboard and must never be stored: before this fix it was 83% of every
// row a real org's activity_events table held (3,978 of 4,787).
func TestDropAllowedEvents(t *testing.T) {
	events := []models.ActivityEvent{
		{Action: models.EventActionBlocked, Target: "a"},
		{Action: models.EventActionAllowed, Target: "b"},
		{Action: models.EventActionAlerted, Target: "c"},
		{Action: models.EventActionAllowed, Target: "d"},
		{Action: models.EventActionLogged, Target: "e"},
	}

	got := dropAllowedEvents(events)

	if len(got) != 3 {
		t.Fatalf("got %d events, want 3 (allowed rows should be dropped): %+v", len(got), got)
	}
	for _, ev := range got {
		if ev.Action == models.EventActionAllowed {
			t.Errorf("an allowed event survived filtering: %+v", ev)
		}
	}
	// Order-preserving, so a caller pairing filtered events back up with
	// anything positional (logs, indices) doesn't get silently scrambled.
	want := []string{"a", "c", "e"}
	for i, target := range want {
		if got[i].Target != target {
			t.Errorf("index %d: got target %q, want %q — order was not preserved", i, got[i].Target, target)
		}
	}
}

func TestDropAllowedEventsHandlesEmptyAndAllAllowed(t *testing.T) {
	if got := dropAllowedEvents(nil); len(got) != 0 {
		t.Errorf("dropAllowedEvents(nil) = %v, want empty", got)
	}
	if got := dropAllowedEvents([]models.ActivityEvent{}); len(got) != 0 {
		t.Errorf("dropAllowedEvents([]) = %v, want empty", got)
	}

	allAllowed := []models.ActivityEvent{
		{Action: models.EventActionAllowed},
		{Action: models.EventActionAllowed},
	}
	if got := dropAllowedEvents(allAllowed); len(got) != 0 {
		t.Errorf("a batch of only allowed events should filter to nothing, got %d", len(got))
	}
}

func TestDropAllowedEventsKeepsEverythingWhenNoneAreAllowed(t *testing.T) {
	events := []models.ActivityEvent{
		{Action: models.EventActionBlocked},
		{Action: models.EventActionAlerted},
		{Action: models.EventActionLogged},
	}
	if got := dropAllowedEvents(events); len(got) != 3 {
		t.Errorf("got %d, want all 3 events kept", len(got))
	}
}
