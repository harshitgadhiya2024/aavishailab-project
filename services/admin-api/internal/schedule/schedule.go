// Package schedule decides whether the agent on a given device should be
// enforcing right now.
//
// This exists for BYOD. An agent that runs 24x7 on a personal laptop is
// intercepting somebody's private browsing at 11pm, which is neither
// defensible nor what the company actually wants — it wants the working day.
// A company-owned laptop has no such constraint, so the absence of a schedule
// means "always on" and nothing changes for those devices.
//
// The evaluation lives on the server, not in the agent, for one specific
// reason: the agent's clock and timezone belong to the person being monitored.
// If the agent decided for itself, changing the system clock to Sunday would
// turn enforcement off. Here the answer is computed in the schedule's own
// timezone and handed to the agent as "enforcing until <instant>", which the
// agent tracks against a monotonic clock.
package schedule

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Off-hours behaviour. Pausing entirely is right for a personal device; some
// organizations would rather keep the parts that protect the machine itself
// (a ransomware download does not become harmless at 7pm) while dropping
// everything that observes the person.
const (
	OffHoursFullPause    = "full_pause"
	OffHoursSecurityOnly = "security_only"
)

// Window is one stretch of a weekday during which enforcement is on.
// End <= Start means the window runs past midnight (a 22:00–06:00 support
// shift), which is a real schedule, not a typo.
type Window struct {
	Day   int    `json:"day"` // 0 = Sunday … 6 = Saturday, matching time.Weekday
	Start string `json:"start"`
	End   string `json:"end"`
}

// Spec is a resolved schedule — whichever of the device/team/org schedules won.
type Spec struct {
	Timezone     string   `json:"timezone"`
	Windows      []Window `json:"windows"`
	Holidays     []string `json:"holidays"` // YYYY-MM-DD, in the schedule's timezone
	OffHoursMode string   `json:"off_hours_mode"`
	Enabled      bool     `json:"enabled"`
	Source       string   `json:"source"` // org | team | device — for the UI and the agent log
}

// State is the answer handed to the agent.
type State struct {
	Active bool   `json:"active"`
	Mode   string `json:"mode"`   // full | security_only | paused
	Reason string `json:"reason"` // human-readable, shown in the tray and the dashboard
	// When the current state ends. Nil means "never" — an unscheduled device
	// is enforcing indefinitely.
	Until    *time.Time `json:"until,omitempty"`
	Source   string     `json:"source,omitempty"`
	Timezone string     `json:"timezone,omitempty"`
}

type interval struct{ start, end time.Time }

// Evaluate answers whether enforcement is on at `now`.
//
// A nil, disabled, or empty spec means always on. That is the behaviour a
// company laptop needs and the safe default for a schedule someone
// half-configured: the failure mode of a bad schedule should be "monitored
// anyway", never "silently unmonitored".
func Evaluate(spec *Spec, now time.Time) State {
	if spec == nil || !spec.Enabled || len(spec.Windows) == 0 {
		return State{
			Active: true,
			Mode:   "full",
			Reason: "No working-hours schedule — enforcing continuously",
		}
	}

	loc, err := time.LoadLocation(spec.Timezone)
	if err != nil || loc == nil {
		loc = time.UTC
	}
	local := now.In(loc)

	holidays := map[string]bool{}
	for _, h := range spec.Holidays {
		if h = strings.TrimSpace(h); h != "" {
			holidays[h] = true
		}
	}

	// Build concrete intervals around now rather than doing modular arithmetic
	// on weekdays and minutes. Constructing each one with time.Date in the
	// target location is what makes DST transitions correct for free: on the
	// day a clock shifts, "10:00 local" is whatever instant the zone says it
	// is, and the window is still the working day people actually worked.
	ivs := expand(loc, spec.Windows, holidays, local.AddDate(0, 0, -2), 11)
	ivs = merge(ivs)

	for _, iv := range ivs {
		if !now.Before(iv.start) && now.Before(iv.end) {
			end := iv.end
			return State{
				Active:   true,
				Mode:     "full",
				Reason:   fmt.Sprintf("Within working hours (until %s %s)", end.In(loc).Format("15:04"), zoneName(loc, end)),
				Until:    &end,
				Source:   spec.Source,
				Timezone: spec.Timezone,
			}
		}
	}

	mode := "paused"
	reason := "Outside working hours — monitoring paused"
	if spec.OffHoursMode == OffHoursSecurityOnly {
		mode = "security_only"
		reason = "Outside working hours — malware protection only, no monitoring"
	}

	st := State{Active: false, Mode: mode, Reason: reason, Source: spec.Source, Timezone: spec.Timezone}
	for _, iv := range ivs {
		if iv.start.After(now) {
			start := iv.start
			st.Until = &start
			st.Reason = fmt.Sprintf("%s until %s", reason, start.In(loc).Format("Mon 15:04"))
			break
		}
	}
	return st
}

// expand turns weekday windows into dated intervals covering `days` days from
// `from` (all in loc).
func expand(loc *time.Location, windows []Window, holidays map[string]bool, from time.Time, days int) []interval {
	out := make([]interval, 0, len(windows)*days/7+len(windows))
	day := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, loc)

	for d := 0; d < days; d++ {
		cur := day.AddDate(0, 0, d)
		// A holiday suppresses the windows that *start* on it; an overnight
		// window that began the evening before still finishes normally, which
		// is how a shift that runs into a holiday actually behaves.
		if holidays[cur.Format("2006-01-02")] {
			continue
		}
		for _, w := range windows {
			if int(cur.Weekday()) != w.Day {
				continue
			}
			sh, sm, ok := parseHM(w.Start)
			if !ok {
				continue
			}
			eh, em, ok := parseHM(w.End)
			if !ok {
				continue
			}
			start := time.Date(cur.Year(), cur.Month(), cur.Day(), sh, sm, 0, 0, loc)
			end := time.Date(cur.Year(), cur.Month(), cur.Day(), eh, em, 0, 0, loc)
			if !end.After(start) {
				end = end.AddDate(0, 0, 1) // crosses midnight
			}
			out = append(out, interval{start, end})
		}
	}
	return out
}

// merge collapses overlapping or touching intervals, so back-to-back windows
// (09:00–13:00 and 13:00–18:00) report one honest "until 18:00" rather than
// claiming enforcement ends at lunch.
func merge(in []interval) []interval {
	if len(in) < 2 {
		return in
	}
	sort.Slice(in, func(i, j int) bool { return in[i].start.Before(in[j].start) })
	out := []interval{in[0]}
	for _, iv := range in[1:] {
		last := &out[len(out)-1]
		if !iv.start.After(last.end) {
			if iv.end.After(last.end) {
				last.end = iv.end
			}
			continue
		}
		out = append(out, iv)
	}
	return out
}

func parseHM(v string) (int, int, bool) {
	parts := strings.SplitN(strings.TrimSpace(v), ":", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, false
	}
	return h, m, true
}

func zoneName(loc *time.Location, at time.Time) string {
	name, _ := at.In(loc).Zone()
	return name
}

// Validate checks a schedule before it is stored, so a typo surfaces in the
// dashboard rather than as a device that quietly stops being monitored.
func Validate(timezone string, windows []Window, holidays []string) error {
	if _, err := time.LoadLocation(timezone); err != nil {
		return fmt.Errorf("unknown timezone %q", timezone)
	}
	if len(windows) == 0 {
		return fmt.Errorf("add at least one working-hours window")
	}
	for _, w := range windows {
		if w.Day < 0 || w.Day > 6 {
			return fmt.Errorf("day must be 0 (Sunday) to 6 (Saturday), got %d", w.Day)
		}
		if _, _, ok := parseHM(w.Start); !ok {
			return fmt.Errorf("invalid start time %q — use HH:MM", w.Start)
		}
		if _, _, ok := parseHM(w.End); !ok {
			return fmt.Errorf("invalid end time %q — use HH:MM", w.End)
		}
	}
	for _, h := range holidays {
		if h = strings.TrimSpace(h); h == "" {
			continue
		}
		if _, err := time.Parse("2006-01-02", h); err != nil {
			return fmt.Errorf("invalid holiday %q — use YYYY-MM-DD", h)
		}
	}
	return nil
}
