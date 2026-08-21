package models

import "github.com/google/uuid"

// Application control closes the gap between "the website is blocked" and "the
// app is blocked". Blocking chatgpt.com in a policy stops the browser, but a
// desktop client that is already installed keeps working as long as it can
// reach any of its own backends — and nothing stopped it from launching.
//
// A ManagedApplication answers both halves for one piece of software: which
// processes it runs as on each OS, and every domain its backend talks to. An
// AppControlRule is then one organization's decision about it, and the agent
// enforces whichever halves the rule turns on:
//
//	BlockNetwork -> the app's whole domain bundle joins the agent's block list,
//	                so an installed copy can't reach its backend
//	BlockProcess -> matching processes are terminated on sight and reported
//
// Neither half is a substitute for OS-level application control (macOS
// Endpoint Security, Windows WDAC/AppLocker). A determined user can rename a
// binary past the process matcher, and only signed OS extensions can stop a
// process before it runs. What this does give is enforcement that works today,
// on an unmanaged laptop, with no MDM.
type ManagedApplication struct {
	Base
	// OrgID NULL means a built-in catalog entry shared by every organization;
	// a non-NULL OrgID is an application one company defined itself. Same
	// tenancy rule as CategoryDomain.
	OrgID *uuid.UUID `gorm:"type:uuid;index" json:"org_id"`

	Name        string `gorm:"not null" json:"name"`
	Slug        string `gorm:"not null;index" json:"slug"`
	Vendor      string `json:"vendor"`
	Category    string `gorm:"index" json:"category"` // ai_tools, file_sharing, remote_access, …
	Description string `json:"description"`
	RiskLevel   int    `gorm:"default:50" json:"risk_level"`

	// IconKey is a storage.Backend object key (not a URL — URLs are minted
	// fresh per response via SignedURL, same reasoning as Screenshot.StorageKey).
	// Empty when no logo has been uploaded; callers fall back to a generated
	// initial/placeholder client-side.
	IconKey string `gorm:"column:icon_key" json:"-"`

	// ── Process identity ─────────────────────────────────────────────────
	// Matched case-insensitively against the executable's own name, so
	// "chatgpt.exe" matches regardless of where it was installed.
	ProcessNames []string `gorm:"type:jsonb;serializer:json" json:"process_names"`
	// macOS bundle identifiers, matched against the app bundle a process
	// belongs to. Survives renaming the .app.
	BundleIDs []string `gorm:"type:jsonb;serializer:json" json:"bundle_ids"`
	// Substring matches on the executable's own path — the fallback for apps
	// whose binary name is too generic to match on ("electron", "node").
	// Deliberately not matched against the command line: a process that merely
	// mentions an app in its arguments (a grep, an editor, a build script) is
	// not that app, and terminating it over a string in argv is indefensible.
	PathPatterns []string `gorm:"type:jsonb;serializer:json" json:"path_patterns"`

	// ── Network identity ─────────────────────────────────────────────────
	// Every backend host the app needs. This is the "domain bundle": blocking
	// the marketing site alone leaves the desktop client working, because it
	// talks to the API host, the auth host and the telemetry host instead.
	Domains []string `gorm:"type:jsonb;serializer:json" json:"domains"`

	Source string `gorm:"default:'seed'" json:"source"` // seed | manual
}

// AppControlRule is one organization's decision about one application.
type AppControlRule struct {
	Base
	// One rule per (org, application) — enforced by a partial unique index
	// created in database.MigrateAppControlIndexes, not by a plain uniqueIndex
	// tag: these rows soft-delete, and a plain index counts deleted rows, so
	// removing a rule and adding it back would collide.
	OrgID         uuid.UUID `gorm:"type:uuid;not null;index" json:"org_id"`
	ApplicationID uuid.UUID `gorm:"type:uuid;not null;index" json:"application_id"`

	Action  string `gorm:"default:'block'" json:"action"` // block | alert
	Enabled bool   `gorm:"default:true" json:"enabled"`

	// Which halves of enforcement are on. Network-only is the safe default for
	// an app people may legitimately have installed; process termination is
	// deliberate and opt-in.
	BlockNetwork bool `gorm:"default:true" json:"block_network"`
	BlockProcess bool `gorm:"default:false" json:"block_process"`

	// Same targeting shape as Policy.Targets: nil/empty means the whole org,
	// otherwise {"employee_ids": [...], "team_ids": [...]}.
	Targets map[string]any `gorm:"type:jsonb;serializer:json" json:"targets"`

	Application *ManagedApplication `gorm:"foreignKey:ApplicationID" json:"application,omitempty"`
}

// AppControlMatcher is what the agent receives — a flattened rule with no DB
// identifiers, carrying only what it needs to recognise and act on a process.
type AppControlMatcher struct {
	AppID        string   `json:"app_id"`
	Name         string   `json:"name"`
	Action       string   `json:"action"` // block | alert
	ProcessNames []string `json:"process_names"`
	BundleIDs    []string `json:"bundle_ids"`
	PathPatterns []string `json:"path_patterns"`
}
