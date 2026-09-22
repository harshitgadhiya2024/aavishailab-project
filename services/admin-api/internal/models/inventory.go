package models

import (
	"time"

	"github.com/google/uuid"
)

// Software inventory — what is actually installed on each employee's machine.
//
// This is the counterpart to ManagedApplication, and the two answer different
// questions. ManagedApplication is a *catalog*: "here is what Slack looks like
// on each OS, and which domains it talks to" — a shared, curated description
// that exists whether or not anybody has Slack. InstalledApplication is
// *observation*: "this device has this application, and we first saw it at
// this time".
//
// Keeping them apart is what makes the Application Control view employee-
// shaped rather than catalog-shaped. An employee installing something nobody
// has ever catalogued (a CLI tool, an internal build, a niche editor) still
// produces a row here — which is the whole point, since the apps a company
// most wants to know about are the ones it did not anticipate. When an
// inventory row *does* match a catalog entry, ApplicationID links them so the
// curated category, risk and domain bundle come along for free.
type InstalledApplication struct {
	Base

	OrgID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"org_id"`
	DeviceID   uuid.UUID  `gorm:"type:uuid;not null;index" json:"device_id"`
	EmployeeID *uuid.UUID `gorm:"type:uuid;index" json:"employee_id"`

	// Identifier is the stable, OS-native key for this application: a macOS
	// CFBundleIdentifier, a Windows uninstall-registry key, a Linux package
	// name. It is what makes re-reporting idempotent — the display name
	// changes between versions ("Visual Studio Code" → "Code"), the identifier
	// does not. Falls back to a normalised name when the OS offers nothing
	// better, which is still stable for the same install.
	Identifier string `gorm:"not null;index" json:"identifier"`

	Name        string `gorm:"not null;index" json:"name"`
	Version     string `json:"version"`
	Vendor      string `json:"vendor"`
	InstallPath string `json:"install_path"`

	// Source is where on the machine this was found, which is also how much to
	// trust the metadata: registry | applications | dpkg | rpm | snap |
	// flatpak | path. A "path" row is a binary found in a user-writable
	// location with no package manager behind it — a manual download, which is
	// exactly the case the requirement calls out and the one no package
	// database would ever have reported.
	Source string `gorm:"index" json:"source"`

	// ── Catalog link, resolved at ingest ──────────────────────────────────
	// Nil when nothing in the catalog matched. Category and RiskLevel are
	// copied rather than joined so an uncatalogued app can still carry a
	// heuristic category and risk, and so the row reads correctly even after a
	// catalog entry is edited or removed.
	ApplicationID *uuid.UUID `gorm:"type:uuid;index" json:"application_id"`
	Category      string     `gorm:"index" json:"category"`
	RiskLevel     int        `gorm:"default:0" json:"risk_level"`

	// InstalledAt is what the operating system reports, and is often absent —
	// Windows records an install date, macOS and most Linux package managers
	// record nothing reliable. FirstSeenAt is the honest fallback the UI shows
	// when it is: "we first saw this here", not a fabricated install time.
	InstalledAt *time.Time `json:"installed_at"`
	FirstSeenAt time.Time  `gorm:"index" json:"first_seen_at"`
	LastSeenAt  time.Time  `gorm:"index" json:"last_seen_at"`

	// Removed marks an application the device has stopped reporting. The row is
	// kept rather than deleted: "this laptop had a remote-access tool on it for
	// three weeks and then it went away" is exactly the history a security team
	// needs, and deleting it would erase the only evidence.
	Removed   bool       `gorm:"default:false;index" json:"removed"`
	RemovedAt *time.Time `json:"removed_at"`

	Device      *Device             `gorm:"foreignKey:DeviceID" json:"device,omitempty"`
	Employee    *Employee           `gorm:"foreignKey:EmployeeID;references:ID" json:"employee,omitempty"`
	Application *ManagedApplication `gorm:"foreignKey:ApplicationID" json:"application,omitempty"`
}
