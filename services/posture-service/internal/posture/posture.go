// Package posture scores a device's security posture from reported signals.
//
// Each control contributes a weight; a device starts at 100 and loses the
// full weight for a control that is explicitly OFF, and half for one that is
// UNKNOWN (the agent couldn't determine it) — unknown is a weaker signal than
// a confirmed failure but still isn't "compliant". The score maps to
// pass / warn / fail via configurable thresholds, so an admin can make posture
// a policy condition ("block if posture below warn").
package posture

// Signals are the raw posture facts reported by the endpoint agent. Pointers so
// a nil means "unknown / couldn't determine", distinct from an explicit false.
type Signals struct {
	DiskEncryption *bool  `json:"disk_encryption"`
	Firewall       *bool  `json:"firewall"`
	OSUpToDate     *bool  `json:"os_up_to_date"`
	ScreenLock     *bool  `json:"screen_lock"`
	Antivirus      *bool  `json:"antivirus"`
	OSType         string `json:"os_type"`
	OSVersion      string `json:"os_version"`
}

type control struct {
	key    string
	label  string
	weight int
	val    *bool
}

// Weights sum to 100.
func controls(s Signals) []control {
	return []control{
		{"disk_encryption", "disk encryption", 30, s.DiskEncryption},
		{"firewall", "host firewall", 20, s.Firewall},
		{"os_up_to_date", "OS up to date", 20, s.OSUpToDate},
		{"screen_lock", "screen lock / auto-lock", 15, s.ScreenLock},
		{"antivirus", "antivirus present", 15, s.Antivirus},
	}
}

type Result struct {
	Score   int      `json:"score"`
	Status  string   `json:"status"` // pass | warn | fail
	Passed  []string `json:"passed"`
	Failed  []string `json:"failed"`
	Unknown []string `json:"unknown"`
	Reasons []string `json:"reasons"`
}

func Evaluate(s Signals, passThreshold, warnThreshold int) Result {
	score := 100
	r := Result{}
	for _, c := range controls(s) {
		switch {
		case c.val == nil:
			score -= c.weight / 2
			r.Unknown = append(r.Unknown, c.key)
			r.Reasons = append(r.Reasons, "could not determine "+c.label)
		case *c.val:
			r.Passed = append(r.Passed, c.key)
		default:
			score -= c.weight
			r.Failed = append(r.Failed, c.key)
			r.Reasons = append(r.Reasons, c.label+" is disabled")
		}
	}
	if score < 0 {
		score = 0
	}
	r.Score = score

	if warnThreshold >= passThreshold {
		warnThreshold = passThreshold - 1
	}
	switch {
	case score >= passThreshold:
		r.Status = "pass"
	case score >= warnThreshold:
		r.Status = "warn"
	default:
		r.Status = "fail"
	}
	if len(r.Reasons) == 0 {
		r.Reasons = []string{"all posture checks passed"}
	}
	return r
}
