package handlers

import "testing"

// The open-app list lands in a jsonb column that a dashboard renders, and it
// arrives from an agent. The server does not trust its shape.
func TestParseOpenApps(t *testing.T) {
	t.Run("splits and trims", func(t *testing.T) {
		got := parseOpenApps("Google Chrome, Slack ,  Visual Studio Code")
		want := []string{"Google Chrome", "Slack", "Visual Studio Code"}
		if len(got) != len(want) {
			t.Fatalf("got %v, want %v", got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("index %d: got %q, want %q", i, got[i], want[i])
			}
		}
	})

	// nil, not an empty slice: the column stays JSON null, so the dashboard
	// takes the same "no list for this capture" branch it takes for every
	// screenshot recorded before this feature existed. An empty row of chips
	// would read as "nothing was open", which is a different claim.
	t.Run("nothing yields nil", func(t *testing.T) {
		for _, in := range []string{"", "   ", ",,,", " , , "} {
			if got := parseOpenApps(in); got != nil {
				t.Errorf("parseOpenApps(%q) = %v, want nil", in, got)
			}
		}
	})

	t.Run("deduplicates case-insensitively", func(t *testing.T) {
		got := parseOpenApps("Slack,slack,SLACK,Chrome")
		if len(got) != 2 {
			t.Fatalf("got %v, want 2 entries", got)
		}
		if got[0] != "Slack" || got[1] != "Chrome" {
			t.Errorf("got %v, want first-seen spelling preserved", got)
		}
	})

	t.Run("caps the list", func(t *testing.T) {
		raw := ""
		for i := 0; i < maxOpenApps+15; i++ {
			raw += string(rune('a'+i%26)) + string(rune('0'+i/26)) + ","
		}
		if got := parseOpenApps(raw); len(got) > maxOpenApps {
			t.Errorf("got %d entries, want at most %d", len(got), maxOpenApps)
		}
	})

	t.Run("truncates an absurdly long name", func(t *testing.T) {
		long := ""
		for i := 0; i < 200; i++ {
			long += "x"
		}
		got := parseOpenApps(long)
		if len(got) != 1 || len(got[0]) != 60 {
			t.Errorf("got %d entries of length %d, want one of length 60", len(got), len(got[0]))
		}
	})
}
