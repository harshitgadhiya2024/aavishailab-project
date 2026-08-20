package models

import (
	"time"

	"github.com/google/uuid"
)

// Time-and-activity monitoring — the TeamLogger-style half of the platform.
// A WorkSession is a continuous stretch of a person working on one device; it
// holds the Screenshots taken during it, each of which carries the activity
// measured over the interval leading up to it. Capture obeys the same
// working-hours gate as everything else: a company laptop with no schedule is
// watched around the clock, a personal one only inside its window, and nothing
// is captured while enforcement is paused.

// WorkSession groups the screenshots and activity of one continuous work
// period. The agent opens one when capture begins and closes it when capture
// stops (shutdown, or the working day ending), so the dashboard can show
// "14:58 → 19:01" as a single block.
type WorkSession struct {
	Base
	OrgID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"org_id"`
	EmployeeID *uuid.UUID `gorm:"type:uuid;index" json:"employee_id"`
	DeviceID   *uuid.UUID `gorm:"type:uuid;index" json:"device_id"`

	StartedAt time.Time  `gorm:"index" json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"` // nil while the session is live

	// Context shown on the session card. Project/Task are placeholders until
	// the platform grows real project tracking — kept so the shape is right.
	Project  string `gorm:"default:'Default Project'" json:"project"`
	Task     string `gorm:"default:'Default Task'" json:"task"`
	Hostname string `json:"hostname"`
	IP       string `json:"ip"`
	Notes    string `json:"notes"`

	// Rolled up from the session's screenshots so a list view doesn't have to
	// load every image row. Refreshed as screenshots arrive.
	ScreenshotCount int     `gorm:"default:0" json:"screenshot_count"`
	ActiveSeconds   int     `gorm:"default:0" json:"active_seconds"`
	TrackedSeconds  int     `gorm:"default:0" json:"tracked_seconds"`
	AvgActivity     float64 `gorm:"default:0" json:"avg_activity"`

	Employee *Employee `gorm:"foreignKey:EmployeeID" json:"employee,omitempty"`
}

// Screenshot is one captured frame plus the activity measured over the
// interval it represents. The image bytes live in object storage (R2) or on a
// local volume; only the key is stored here.
type Screenshot struct {
	Base
	OrgID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"org_id"`
	EmployeeID *uuid.UUID `gorm:"type:uuid;index" json:"employee_id"`
	DeviceID   *uuid.UUID `gorm:"type:uuid;index" json:"device_id"`
	SessionID  *uuid.UUID `gorm:"type:uuid;index" json:"session_id"`

	CapturedAt time.Time `gorm:"index" json:"captured_at"`
	// The window this screenshot's activity covers — the gap since the previous
	// capture. The card shows this as "15:02 – 15:07".
	IntervalStart time.Time `json:"interval_start"`
	IntervalEnd   time.Time `json:"interval_end"`

	// Where the image lives. Never a URL — the dashboard asks for a short-lived
	// signed one at read time so the bucket stays private.
	StorageKey string `gorm:"not null" json:"-"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Bytes      int    `json:"bytes"`

	// Activity over [IntervalStart, IntervalEnd].
	//
	// ActivityPercent is the share of seconds in the interval that saw any
	// keyboard, mouse or scroll input — the same "activity level" TeamLogger
	// shows under each thumbnail. The raw counts are kept so a reviewer can
	// tell "typing" from "moving the mouse".
	ActivityPercent int `gorm:"default:0" json:"activity_percent"`
	ActiveSeconds   int `gorm:"default:0" json:"active_seconds"`
	IntervalSeconds int `gorm:"default:0" json:"interval_seconds"`
	KeyboardCount   int `gorm:"default:0" json:"keyboard_count"`
	MouseCount      int `gorm:"default:0" json:"mouse_count"`
	ScrollCount     int `gorm:"default:0" json:"scroll_count"`

	// State of the interval, for the timeline colours. Derived on the agent
	// from activity: active | idle. Manual/meeting/break are reserved for when
	// the employee portal can set them.
	State string `gorm:"default:'active';index" json:"state"`

	Employee *Employee `gorm:"foreignKey:EmployeeID" json:"employee,omitempty"`
}

// ScreenshotSettings is one organization's monitoring configuration. Capture
// is off by default: recording someone's screen is intrusive enough that it
// should be a deliberate choice, not something that happens because the agent
// was installed.
type ScreenshotSettings struct {
	Base
	OrgID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"org_id"`

	Enabled bool `gorm:"default:false" json:"enabled"`

	// Random interval bounds, in seconds. A screenshot is taken at a random
	// point in [Min, Max] so it can't be predicted and idled around. Defaults
	// to the requested 1–7 minutes.
	MinIntervalSeconds int `gorm:"default:60" json:"min_interval_seconds"`
	MaxIntervalSeconds int `gorm:"default:420" json:"max_interval_seconds"`

	// A second below which an interval is coloured idle rather than active on
	// the timeline. Not a deduction — just the display threshold.
	IdleThresholdPercent int `gorm:"default:1" json:"idle_threshold_percent"`

	// Blur is a lighter-touch option some companies prefer: prove someone was
	// at their desk without reading their screen. Honoured on the agent.
	Blur bool `gorm:"default:false" json:"blur"`

	// How long to keep images. A cleanup job deletes older ones. 0 = keep.
	RetentionDays int `gorm:"default:90" json:"retention_days"`
}

// DefaultScreenshotSettings is what an org sees before it configures anything.
func DefaultScreenshotSettings(orgID uuid.UUID) ScreenshotSettings {
	return ScreenshotSettings{
		OrgID:                orgID,
		Enabled:              false,
		MinIntervalSeconds:   60,
		MaxIntervalSeconds:   420,
		IdleThresholdPercent: 1,
		RetentionDays:        90,
	}
}
