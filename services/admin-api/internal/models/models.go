package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ─── Base ──────────────────────────────────────────────────────────────────────

type Base struct {
	ID        uuid.UUID      `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (b *Base) BeforeCreate(tx *gorm.DB) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	return nil
}

// ─── Organization ──────────────────────────────────────────────────────────────

type OrgStatus string
type PlanType string

const (
	OrgStatusActive    OrgStatus = "active"
	OrgStatusInactive  OrgStatus = "inactive"
	OrgStatusSuspended OrgStatus = "suspended"
	OrgStatusTrial     OrgStatus = "trial"

	PlanTrial        PlanType = "trial"
	PlanStarter      PlanType = "starter"
	PlanProfessional PlanType = "professional"
	PlanEnterprise   PlanType = "enterprise"
)

type Organization struct {
	Base
	Name    string `gorm:"not null" json:"name"`
	Slug    string `gorm:"uniqueIndex;not null" json:"slug"`
	Domain  string `json:"domain"`
	LogoURL string `json:"logo_url"`

	// ─── Company profile ───
	// Everything a security product ends up needing on a report header, an
	// invoice, or a compliance export. Held as real columns rather than in
	// Settings so they can be queried and shown in exports.
	LegalName    string `json:"legal_name"`
	Industry     string `json:"industry"`
	CompanySize  string `json:"company_size"`
	Website      string `json:"website"`
	Phone        string `json:"phone"`
	ContactEmail string `json:"contact_email"`
	ContactName  string `json:"contact_name"`
	AddressLine1 string `json:"address_line1"`
	AddressLine2 string `json:"address_line2"`
	City         string `json:"city"`
	State        string `json:"state"`
	PostalCode   string `json:"postal_code"`
	Country      string `json:"country"`
	Timezone     string `gorm:"default:'UTC'" json:"timezone"`
	// Registration identifiers a company is actually asked for. Kept as
	// separate columns rather than one "tax id" because they are different
	// numbers with different formats, and finance/compliance exports need them
	// individually.
	GSTNumber          string         `json:"gst_number"`
	PANNumber          string         `json:"pan_number"`
	RegistrationNumber string         `json:"registration_number"`
	TaxID              string         `json:"tax_id"`
	BillingEmail       string         `json:"billing_email"`
	Notes              string         `json:"notes"`
	Status             OrgStatus      `gorm:"type:org_status;default:'trial'" json:"status"`
	Plan               PlanType       `gorm:"type:plan_type;default:'trial'" json:"plan"`
	MaxUsers           int            `gorm:"default:50" json:"max_users"`
	TrialEndsAt        *time.Time     `json:"trial_ends_at"`
	Settings           map[string]any `gorm:"type:jsonb;serializer:json" json:"settings"`

	// Relations
	Users     []User     `gorm:"foreignKey:OrgID" json:"-"`
	Teams     []Team     `gorm:"foreignKey:OrgID" json:"-"`
	Employees []Employee `gorm:"foreignKey:OrgID" json:"-"`
	Policies  []Policy   `gorm:"foreignKey:OrgID" json:"-"`
}

// ─── User ─────────────────────────────────────────────────────────────────────

type UserRole string
type UserStatus string
type SuperAdminLevel string

const (
	RoleSuperAdmin UserRole = "superadmin"
	RoleOrgAdmin   UserRole = "org_admin"
	// RoleManager owns a set of teams rather than the whole org — see UserTeam.
	RoleManager  UserRole = "manager"
	RoleAnalyst  UserRole = "analyst"
	RoleReadOnly UserRole = "read_only"

	// SuperAdminLevelFull can do anything a superadmin route allows,
	// including destructive actions (org delete, agent rollback, catalog
	// delete, team management). SuperAdminLevelSupport can sign in and see
	// everything under /superadmin but is blocked from those — a support
	// engineer who needs to look something up shouldn't also be able to
	// delete a customer's organization.
	SuperAdminLevelFull    SuperAdminLevel = "full"
	SuperAdminLevelSupport SuperAdminLevel = "support"

	StatusActive    UserStatus = "active"
	StatusInactive  UserStatus = "inactive"
	StatusSuspended UserStatus = "suspended"
	StatusPending   UserStatus = "pending"
)

type User struct {
	Base
	OrgID        *uuid.UUID `gorm:"type:uuid;index" json:"org_id"`
	Email        string     `gorm:"not null;index" json:"email"`
	PasswordHash string     `gorm:"not null" json:"-"`
	FirstName    string     `json:"first_name"`
	LastName     string     `json:"last_name"`
	Role         UserRole   `gorm:"type:user_role;default:'analyst'" json:"role"`
	Status       UserStatus `gorm:"type:user_status;default:'active'" json:"status"`
	AvatarURL    string     `json:"avatar_url"`
	Phone        string     `json:"phone"`
	Department   string     `json:"department"`
	JobTitle     string     `json:"job_title"`
	LastLoginAt  *time.Time `json:"last_login_at"`
	// SuperAdminLevel only means anything when Role is RoleSuperAdmin — see
	// its doc comment above. Defaulted to "full" so every superadmin created
	// before this field existed (and any created without setting it) keeps
	// exactly the access it already had.
	SuperAdminLevel SuperAdminLevel `gorm:"column:superadmin_level;type:varchar(20);default:'full'" json:"superadmin_level,omitempty"`
	// ─── Multi-factor authentication ───
	// MFASecret is the TOTP shared secret. It is stored plainly because it must
	// be readable to verify a code (unlike a password, which is only ever
	// compared); MFAEnabled stays false until the user proves they can generate
	// a code, so an abandoned setup never locks anyone out.
	MFASecret     string         `gorm:"column:mfa_secret" json:"-"`
	MFAEnabled    bool           `gorm:"column:mfa_enabled;default:false" json:"mfa_enabled"`
	MFAEnrolledAt *time.Time     `gorm:"column:mfa_enrolled_at" json:"mfa_enrolled_at"`
	Settings      map[string]any `gorm:"type:jsonb;serializer:json" json:"settings"`

	// Relations
	Org *Organization `gorm:"foreignKey:OrgID" json:"org,omitempty"`
}

func (u *User) FullName() string {
	return u.FirstName + " " + u.LastName
}

// MFARecoveryCode is a single-use way back in when the authenticator device is
// gone. Only the hash is kept, so a database leak yields no usable second
// factor; UsedAt is recorded rather than deleting the row, because "one of your
// recovery codes was used" is exactly the kind of thing worth being able to see.
type MFARecoveryCode struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	CodeHash  string     `gorm:"not null;index" json:"-"`
	UsedAt    *time.Time `json:"used_at"`
	CreatedAt time.Time  `json:"created_at"`
}

// ─── RefreshToken ─────────────────────────────────────────────────────────────

type RefreshToken struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID     uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	TokenHash  string    `gorm:"uniqueIndex;not null" json:"-"`
	ExpiresAt  time.Time `json:"expires_at"`
	DeviceInfo string    `json:"device_info"`
	IPAddress  string    `json:"ip_address"`
	Revoked    bool      `gorm:"default:false" json:"revoked"`
	// RevokedAt powers the rotation grace window: a token that was rotated
	// moments ago is still accepted, because parallel tabs/requests routinely
	// present the same refresh token at the same instant.
	RevokedAt *time.Time `json:"revoked_at"`
	CreatedAt time.Time  `json:"created_at"`
}

// EmployeeRefreshToken is the Employee Portal's equivalent of RefreshToken.
// Portal sessions belong to an Employee, not a User, so they get their own
// table rather than a nullable user_id on the shared one.
type EmployeeRefreshToken struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	EmployeeID uuid.UUID  `gorm:"type:uuid;not null;index" json:"employee_id"`
	TokenHash  string     `gorm:"uniqueIndex;not null" json:"-"`
	ExpiresAt  time.Time  `json:"expires_at"`
	DeviceInfo string     `json:"device_info"`
	IPAddress  string     `json:"ip_address"`
	Revoked    bool       `gorm:"default:false" json:"revoked"`
	RevokedAt  *time.Time `json:"revoked_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

// ─── PasswordResetToken ────────────────────────────────────────────────────────

// PasswordResetToken backs both the company (User) and employee portal
// (Employee) forgot-password flows — exactly one of UserID/EmployeeID is set.
type PasswordResetToken struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID     *uuid.UUID `gorm:"type:uuid;index" json:"user_id"`
	EmployeeID *uuid.UUID `gorm:"type:uuid;index" json:"employee_id"`
	TokenHash  string     `gorm:"uniqueIndex;not null" json:"-"`
	ExpiresAt  time.Time  `json:"expires_at"`
	Used       bool       `gorm:"default:false" json:"used"`
	CreatedAt  time.Time  `json:"created_at"`
}

// ─── Team ─────────────────────────────────────────────────────────────────────

type Team struct {
	Base
	OrgID       uuid.UUID  `gorm:"type:uuid;not null;index" json:"org_id"`
	Name        string     `gorm:"not null" json:"name"`
	Description string     `json:"description"`
	Color       string     `gorm:"default:'#0048A0'" json:"color"`
	CreatedBy   *uuid.UUID `gorm:"type:uuid" json:"created_by"`

	// Relations
	Org         *Organization `gorm:"foreignKey:OrgID" json:"org,omitempty"`
	Employees   []Employee    `gorm:"foreignKey:TeamID" json:"employees,omitempty"`
	MemberCount int           `gorm:"-" json:"member_count"`
}

// ─── Employee ─────────────────────────────────────────────────────────────────

type Employee struct {
	Base
	OrgID              uuid.UUID      `gorm:"type:uuid;not null;index" json:"org_id"`
	UserID             *uuid.UUID     `gorm:"type:uuid" json:"user_id"`
	EmployeeID         *uuid.UUID     `gorm:"type:uuid" json:"employee_id"`
	FirstName          string         `gorm:"not null" json:"first_name"`
	LastName           string         `gorm:"not null" json:"last_name"`
	Email              string         `gorm:"not null;index" json:"email"`
	Phone              string         `json:"phone"`
	Department         string         `json:"department"`
	JobTitle           string         `json:"job_title"`
	TeamID             *uuid.UUID     `gorm:"type:uuid;index" json:"team_id"`
	Status             UserStatus     `gorm:"type:user_status;default:'active'" json:"status"`
	RiskScore          float64        `gorm:"default:0" json:"risk_score"`
	AvatarURL          string         `json:"avatar_url"`
	DeviceCount        int            `gorm:"default:0" json:"device_count"`
	LastActiveAt       *time.Time     `json:"last_active_at"`
	PortalPasswordHash string         `gorm:"column:portal_password_hash" json:"-"`
	Metadata           map[string]any `gorm:"type:jsonb;serializer:json" json:"metadata"`

	// Relations
	Team *Team         `gorm:"foreignKey:TeamID" json:"team,omitempty"`
	Org  *Organization `gorm:"foreignKey:OrgID" json:"org,omitempty"`
	// references:ID is explicit here because Employee also has its own
	// EmployeeID field (an external HRIS identifier, unrelated to this
	// association) — without it GORM's foreign-key inference collides with
	// that field instead of the primary key, and silently returns no rows.
	Devices []Device `gorm:"foreignKey:EmployeeID;references:ID" json:"devices,omitempty"`
}

func (e *Employee) FullName() string {
	return e.FirstName + " " + e.LastName
}

// ─── Device ───────────────────────────────────────────────────────────────────

type Device struct {
	Base
	OrgID        uuid.UUID  `gorm:"type:uuid;not null;index" json:"org_id"`
	EmployeeID   *uuid.UUID `gorm:"type:uuid;index" json:"employee_id"`
	Hostname     string     `gorm:"not null" json:"hostname"`
	OSType       string     `json:"os_type"`
	OSVersion    string     `json:"os_version"`
	AgentVersion string     `json:"agent_version"`
	MACAddress   string     `json:"mac_address"`
	// MachineID is a hash of the machine's hardware identity, sent by the
	// agent at enrollment. It is how a reinstall on the same laptop is
	// recognised as the same device even when it is enrolled for someone
	// else, or the hostname is one many machines share.
	MachineID string `gorm:"index" json:"-"`
	IPAddress string `json:"ip_address"`
	Status    string `gorm:"default:'offline'" json:"status"`
	// company | personal. Personal (BYOD) devices are the reason working-hours
	// schedules exist; see models/enforcement.go. A company-owned device is
	// never paused, whatever schedule it inherits — see deviceEnforcement.
	Ownership string `gorm:"default:'company';index" json:"ownership"`

	LastSeenAt *time.Time `json:"last_seen_at"`
	PostureScore int            `gorm:"default:100" json:"posture_score"`
	EnrolledAt   time.Time      `json:"enrolled_at"`
	Metadata     map[string]any `gorm:"type:jsonb;serializer:json" json:"metadata"`

	// references:ID — see the note on Employee.Devices above.
	Employee *Employee `gorm:"foreignKey:EmployeeID;references:ID" json:"employee,omitempty"`
}

// ─── Policy ───────────────────────────────────────────────────────────────────

type PolicyType string
type PolicyAction string

const (
	PolicyTypeURLCategory PolicyType = "url_category"
	PolicyTypeDomain      PolicyType = "domain"
	PolicyTypeApplication PolicyType = "application"
	PolicyTypeUSB         PolicyType = "usb"
	PolicyTypeDLP         PolicyType = "dlp"
	PolicyTypeTimeBased   PolicyType = "time_based"
	PolicyTypeProcess     PolicyType = "process"

	PolicyActionBlock PolicyAction = "block"
	PolicyActionAllow PolicyAction = "allow"
	PolicyActionAlert PolicyAction = "alert"
	PolicyActionLog   PolicyAction = "log"
)

type Policy struct {
	Base
	OrgID       uuid.UUID      `gorm:"type:uuid;not null;index" json:"org_id"`
	Name        string         `gorm:"not null" json:"name"`
	Description string         `json:"description"`
	Type        PolicyType     `gorm:"type:policy_type;not null" json:"type"`
	Action      PolicyAction   `gorm:"type:policy_action;default:'block'" json:"action"`
	Priority    int            `gorm:"default:100" json:"priority"`
	Enabled     bool           `gorm:"default:true" json:"enabled"`
	Rules       map[string]any `gorm:"type:jsonb;serializer:json" json:"rules"`
	Targets     map[string]any `gorm:"type:jsonb;serializer:json" json:"targets"`
	RegoBundle  string         `json:"rego_bundle,omitempty"`
	Version     int            `gorm:"default:1" json:"version"`
	CreatedBy   *uuid.UUID     `gorm:"type:uuid" json:"created_by"`
	UpdatedBy   *uuid.UUID     `gorm:"type:uuid" json:"updated_by"`

	Org *Organization `gorm:"foreignKey:OrgID" json:"org,omitempty"`
}

// ─── Policy Assignment ────────────────────────────────────────────────────────

type PolicyAssignment struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	PolicyID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"policy_id"`
	OrgID       uuid.UUID  `gorm:"type:uuid;not null;index" json:"org_id"`
	TargetType  string     `gorm:"not null" json:"target_type"` // all, team, employee, department
	TargetID    *uuid.UUID `gorm:"type:uuid" json:"target_id"`
	TargetValue string     `json:"target_value"`
	CreatedAt   time.Time  `json:"created_at"`

	Policy *Policy `gorm:"foreignKey:PolicyID" json:"policy,omitempty"`
}

// ─── Domain Rule (SWG) ────────────────────────────────────────────────────────

type DomainRule struct {
	Base
	OrgID     *uuid.UUID   `gorm:"type:uuid;index" json:"org_id"` // NULL = global
	Domain    string       `gorm:"not null;index" json:"domain"`
	Action    PolicyAction `gorm:"type:policy_action;default:'block'" json:"action"`
	Category  string       `json:"category"`
	Reason    string       `json:"reason"`
	Source    string       `gorm:"default:'manual'" json:"source"`
	RiskScore int          `gorm:"default:0" json:"risk_score"` // set when Source == "risk_engine"
	ExpiresAt *time.Time   `json:"expires_at"`
	Enabled   bool         `gorm:"default:true" json:"enabled"`
}

// ─── Threat Intel (synced from free, open, no-key threat feeds) ──────────────
// Sources: URLhaus (malware), OpenPhish community feed (phishing), Feodo
// Tracker (botnet C2) — all abuse.ch/OpenPhish public feeds, no signup or
// paid API involved.

type ThreatIntelDomain struct {
	Base
	Domain     string    `gorm:"not null;uniqueIndex" json:"domain"`
	Source     string    `gorm:"not null" json:"source"`   // urlhaus, openphish, feodotracker
	Category   string    `gorm:"not null" json:"category"` // malware, phishing, botnet
	LastSeenAt time.Time `json:"last_seen_at"`
}

// ─── File Verdict ─────────────────────────────────────────────────────────────
// The last malware verdict for one file, keyed by the SHA-256 the scanner
// computed from the bytes it scanned — never a hash an agent merely claimed,
// so a device cannot vouch for a file it did not upload. Platform-level, not
// org data: a hash and a verdict say nothing about who downloaded it, and
// sharing them is what lets the second device to fetch an installer get an
// answer without uploading it again.

type FileVerdict struct {
	SHA256    string    `gorm:"primaryKey;size:64" json:"sha256"`
	Action    string    `gorm:"not null" json:"action"` // block | alert | allow
	Band      string    `json:"band"`
	Verdict   string    `json:"verdict"`
	Score     int       `json:"score"`
	Signature string    `json:"signature"`
	Reason    string    `json:"reason"`
	ScannedAt time.Time `gorm:"not null" json:"scanned_at"`
}

// MITMRefusal is one device reporting that an app on it refused SSL
// inspection for a host (see handlers/mitm_learning.go). The rows decide
// which platforms are passed through for every device of an org.
type MITMRefusal struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	OrgID       uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_mitm_refusal_device_host" json:"org_id"`
	DeviceID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_mitm_refusal_device_host" json:"device_id"`
	Host        string    `gorm:"not null;uniqueIndex:idx_mitm_refusal_device_host" json:"host"`
	Domain      string    `gorm:"not null;index" json:"domain"`
	Reason      string    `json:"reason"`
	DLPRelevant bool      `gorm:"not null;default:false" json:"dlp_relevant"`
	Categorised bool      `gorm:"not null;default:false" json:"categorised"`
	Count       int       `gorm:"not null;default:1" json:"count"`
	FirstSeen   time.Time `gorm:"not null" json:"first_seen"`
	LastSeen    time.Time `gorm:"not null;index" json:"last_seen"`
}

// ─── Domain Risk Assessment ───────────────────────────────────────────────────
// Caches the computed risk score + reasoning per domain so expensive checks
// (WHOIS lookups) aren't repeated on every visit, and so there's an audit
// trail explaining why a domain was scored the way it was.

type DomainRiskAssessment struct {
	Base
	Domain         string    `gorm:"not null;uniqueIndex" json:"domain"`
	RiskScore      int       `json:"risk_score"`
	Category       string    `json:"category"`
	Reasons        []string  `gorm:"type:jsonb;serializer:json" json:"reasons"`
	DomainAgeDays  *int      `json:"domain_age_days"`
	ThreatIntelHit bool      `json:"threat_intel_hit"`
	AssessedAt     time.Time `json:"assessed_at"`
}

// ─── URL Category ─────────────────────────────────────────────────────────────

type URLCategory struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	Name        string    `gorm:"uniqueIndex;not null" json:"name"`
	Slug        string    `gorm:"uniqueIndex;not null" json:"slug"`
	Description string    `json:"description"`
	RiskLevel   int       `gorm:"default:0" json:"risk_level"`
	Color       string    `json:"color"`
}

// CategoryDomain is a member domain of a URLCategory (many domains per
// category) — what actually lets a "block category: Gambling" policy
// resolve to a concrete list of domains to block, rather than being a
// label with no enforcement meaning.
type CategoryDomain struct {
	Base
	// OrgID NULL means a built-in domain from the shipped seed lists, shared
	// by every organization. A non-NULL OrgID is a domain one company added
	// itself, visible only to that company.
	OrgID      *uuid.UUID `gorm:"type:uuid;index" json:"org_id"`
	CategoryID uuid.UUID  `gorm:"type:uuid;not null;index" json:"category_id"`
	Domain     string     `gorm:"not null;index" json:"domain"`
	Source     string     `gorm:"default:'manual'" json:"source"` // manual, seed

	Category *URLCategory `gorm:"foreignKey:CategoryID" json:"category,omitempty"`
}

// CategoryDomainExclusion hides one built-in (org_id IS NULL) category domain
// from a single organization. Companies can prune the shipped lists without
// the removal leaking into other tenants: the seed row stays put, this row
// masks it for one org only.
type CategoryDomainExclusion struct {
	Base
	OrgID      uuid.UUID `gorm:"type:uuid;not null;index;uniqueIndex:idx_category_domain_exclusion" json:"org_id"`
	CategoryID uuid.UUID `gorm:"type:uuid;not null;index;uniqueIndex:idx_category_domain_exclusion" json:"category_id"`
	Domain     string    `gorm:"not null;uniqueIndex:idx_category_domain_exclusion" json:"domain"`
}

// CategoryExclusion is CategoryDomainExclusion's whole-category analog:
// "delete this entire category" from one org's point of view. It never
// touches the shared URLCategory row — every other org keeps seeing the
// category exactly as before — it only makes this one org's category list
// and policy-builder category picker stop showing it. Reversible (see
// CategoryHandler.Restore), unlike an actual row delete would be, because
// hiding a whole category is a much bigger blast radius than one domain.
type CategoryExclusion struct {
	Base
	OrgID      uuid.UUID `gorm:"type:uuid;not null;index;uniqueIndex:idx_category_exclusion" json:"org_id"`
	CategoryID uuid.UUID `gorm:"type:uuid;not null;index;uniqueIndex:idx_category_exclusion" json:"category_id"`
}

// ─── CASB app-control rule ────────────────────────────────────────────────────

// CASBRule is one org-authored inline app-control rule: "for this kind of app,
// doing this kind of thing, do X". Rules are evaluated in Priority order and
// take precedence over casb-service's built-in defaults, which is how a company
// overrides a default that's too strict (or too loose) for it.
//
// A nil match field means "any" — nil Sanctioned matches both sanctioned and
// unsanctioned apps, nil MinRisk matches any risk score.
type CASBRule struct {
	Base
	OrgID      uuid.UUID    `gorm:"type:uuid;not null;index" json:"org_id"`
	Name       string       `gorm:"not null" json:"name"`
	Category   string       `json:"category"`                      // "" = any
	App        string       `json:"app"`                           // "" = any
	Activity   string       `gorm:"default:'any'" json:"activity"` // upload|download|share|post|login|any
	Sanctioned *bool        `json:"sanctioned"`                    // nil = any
	MinRisk    *int         `json:"min_risk"`                      // nil = any
	Action     PolicyAction `gorm:"type:policy_action;default:'alert'" json:"action"`
	Priority   int          `gorm:"default:100" json:"priority"`
	Enabled    bool         `gorm:"default:true" json:"enabled"`
}

// ─── Activity Event ───────────────────────────────────────────────────────────

type EventType string
type EventAction string

const (
	EventTypeWebRequest   EventType = "web_request"
	EventTypeDNSQuery     EventType = "dns_query"
	EventTypeAppLaunch    EventType = "app_launch"
	EventTypeUSBInsert    EventType = "usb_insert"
	EventTypeFileOp       EventType = "file_op"
	EventTypeProcessStart EventType = "process_start"
	EventTypeLogin        EventType = "login"
	EventTypeLogout       EventType = "logout"
	EventTypePolicyViol   EventType = "policy_violation"

	// Device-lifecycle events — what the company sees on the Devices activity
	// view. Added to the enum by database.MigrateEventTypes.
	EventTypeDeviceConnect    EventType = "device_connect"
	EventTypeDeviceDisconnect EventType = "device_disconnect"
	EventTypeDeviceUninstall  EventType = "device_uninstall"

	// EventTypeAppInstall is written once, the first time a device reports an
	// application in its software inventory — see InstalledApplication. It is
	// the "employee installed X" line on the Activity tab, distinct from
	// EventTypeProcessStart, which is app control noticing X *running*.
	EventTypeAppInstall EventType = "app_install"

	EventActionBlocked EventAction = "blocked"
	EventActionAllowed EventAction = "allowed"
	EventActionAlerted EventAction = "alerted"
	EventActionLogged  EventAction = "logged"
)

type ActivityEvent struct {
	ID         uuid.UUID   `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	OrgID      uuid.UUID   `gorm:"type:uuid;not null;index;index:idx_activity_org_domain,priority:1" json:"org_id"`
	EmployeeID *uuid.UUID  `gorm:"type:uuid;index" json:"employee_id"`
	DeviceID   *uuid.UUID  `gorm:"type:uuid;index;index:idx_activity_device_dedupe,priority:1" json:"device_id"`
	EventType  EventType   `gorm:"type:event_type;not null;index" json:"event_type"`
	Action     EventAction `gorm:"type:event_action;default:'logged';index" json:"action"`
	Target     string      `json:"target"`
	// TargetDomain was unindexed despite being the GROUP BY key in shadow-IT
	// rollup (shadowit.go), SWG stats, report topDomains, and the risk-engine
	// worker's every-15s scan — all four now hit an index instead of a full
	// table scan. Two composite indexes, not one: (org_id, target_domain)
	// serves the org-scoped rollups; (timestamp, target_domain) serves the
	// risk-engine worker's global "recent activity, not yet assessed" scan,
	// which filters on timestamp with no org_id at all.
	TargetDomain string `gorm:"index:idx_activity_org_domain,priority:2;index:idx_activity_timestamp_domain,priority:2" json:"target_domain"`
	// TargetApp is resolved at read time from TargetDomain via the shadow-IT
	// catalog ("Microsoft Teams" for teams.microsoft.com) so the UI can name the
	// platform instead of showing a raw telemetry hostname. Not persisted: the
	// catalog improves over time and stored copies would go stale.
	TargetApp string `gorm:"-" json:"target_app,omitempty"`
	// Operation is what the person was actually doing when the event fired —
	// "Email sent", "Message sent", "File upload" — rather than just which
	// domain was involved. Derived from the intercepted request (method, path,
	// content type) at capture time, since that context is gone afterwards.
	Operation     string         `json:"operation"`
	Category      string         `json:"category"`
	ProcessName   string         `json:"process_name"`
	PolicyID      *uuid.UUID     `gorm:"type:uuid" json:"policy_id"`
	PolicyName    string         `json:"policy_name"`
	RiskScore     float64        `gorm:"default:0" json:"risk_score"`
	AIExplanation string         `json:"ai_explanation"`
	IPAddress     string         `json:"ip_address"`
	GeoCountry    string         `json:"geo_country"`
	GeoCity       string         `json:"geo_city"`
	Metadata      map[string]any `gorm:"type:jsonb;serializer:json" json:"metadata"`
	// DedupeKey identifies "the same action reported again" (see
	// handlers/event_dedupe.go). A column rather than only metadata.dedupe_key
	// so the fold lookup is a plain indexed equality on every database a
	// company can bring — not a Postgres-only jsonb operator.
	DedupeKey string    `gorm:"index:idx_activity_device_dedupe,priority:2" json:"-"`
	Timestamp time.Time `gorm:"index;index:idx_activity_timestamp_domain,priority:1" json:"timestamp"`
	CreatedAt     time.Time      `json:"created_at"`

	// references:ID — see the note on Employee.Devices above.
	Employee *Employee `gorm:"foreignKey:EmployeeID;references:ID" json:"employee,omitempty"`
	Device   *Device   `gorm:"foreignKey:DeviceID" json:"device,omitempty"`
}

// ─── AI Chat ──────────────────────────────────────────────────────────────────

type AIChatSession struct {
	Base
	OrgID  uuid.UUID `gorm:"type:uuid;not null;index" json:"org_id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Title  string    `gorm:"default:'New Chat'" json:"title"`
	Model  string    `json:"model"`

	Messages []AIChatMessage `gorm:"foreignKey:SessionID" json:"messages,omitempty"`
}

type AIChatMessage struct {
	ID         uuid.UUID      `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	SessionID  uuid.UUID      `gorm:"type:uuid;not null;index" json:"session_id"`
	Role       string         `gorm:"not null" json:"role"`
	Content    string         `gorm:"type:text;not null" json:"content"`
	ToolCalls  map[string]any `gorm:"type:jsonb;serializer:json" json:"tool_calls,omitempty"`
	ToolName   string         `json:"tool_name,omitempty"`
	TokensUsed int            `json:"tokens_used"`
	CreatedAt  time.Time      `json:"created_at"`
}

// ─── Enrollment Token ─────────────────────────────────────────────────────────

// EnrollmentToken is a one-time token used by the agent installer to register a device.
type EnrollmentToken struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	OrgID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"org_id"`
	EmployeeID *uuid.UUID `gorm:"type:uuid;index" json:"employee_id"`
	Token      string     `gorm:"uniqueIndex;not null" json:"token"`
	Label      string     `json:"label"`
	UsedAt     *time.Time `json:"used_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	CreatedBy  *uuid.UUID `gorm:"type:uuid" json:"created_by"`
	CreatedAt  time.Time  `json:"created_at"`
}

// ─── Agent Token ──────────────────────────────────────────────────────────────

// AgentToken authenticates an enrolled device agent on every API call.
type AgentToken struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	DeviceID   uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex" json:"device_id"`
	OrgID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"org_id"`
	EmployeeID *uuid.UUID `gorm:"type:uuid;index" json:"employee_id"`
	TokenHash  string     `gorm:"uniqueIndex;not null" json:"-"`
	Revoked    bool       `gorm:"default:false" json:"revoked"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

// ─── SSL Inspection CA (per-org, for DLP over HTTPS) ──────────────────────────
// Each org gets its own root CA so a compromised/lost device only ever
// exposes trust for that one org's traffic, and uninstalling Aavishield from
// an org is exactly "stop trusting/using this CA" — never a platform-wide
// key. The private key is encrypted at rest (see internal/mitm); only the
// admin-api process holds the key that decrypts it, so leaf-cert signing is
// always a network call from the agent, never something a stolen laptop can
// do offline.

type OrgCACert struct {
	Base
	OrgID           uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"org_id"`
	CertPEM         string    `gorm:"type:text;not null" json:"cert_pem"`
	EncryptedKeyPEM string    `gorm:"type:text;not null" json:"-"`
	SerialNumber    string    `json:"serial_number"`
	ExpiresAt       time.Time `json:"expires_at"`
}

// ─── Access Request (employee-requested exception to a blocking policy) ──────
// An approved request IS the exception — there is no separate exception
// table to keep in sync. Each request names one thing for one employee, and
// approving it opens exactly that:
//
//	website            Resource = the host       → an allow rule for that host
//	                                               (GetRules); a block on a parent
//	                                               domain stays for everything else
//	application        Resource = app id          → the app's process and network
//	                                               rules skip this employee
//	browser_extension  Resource = extension id    → no longer flagged for them
//	download           Resource = file sha256     → that exact file is let through
//	dlp                Resource = the incident id → recorded as a justified
//	                                               business send (DLP is monitor-
//	                                               only, so nothing is unblocked)
//
// Revoking an approved request removes the exception again.

type AccessRequestStatus string

const (
	AccessRequestPending  AccessRequestStatus = "pending"
	AccessRequestApproved AccessRequestStatus = "approved"
	AccessRequestDenied   AccessRequestStatus = "denied"
	AccessRequestRevoked  AccessRequestStatus = "revoked"
)

type AccessRequestKind string

const (
	AccessKindWebsite     AccessRequestKind = "website"
	AccessKindApplication AccessRequestKind = "application"
	AccessKindExtension   AccessRequestKind = "browser_extension"
	AccessKindDownload    AccessRequestKind = "download"
	AccessKindDLP         AccessRequestKind = "dlp"
)

type AccessRequest struct {
	Base
	OrgID      uuid.UUID         `gorm:"type:uuid;not null;index" json:"org_id"`
	EmployeeID uuid.UUID         `gorm:"type:uuid;not null;index" json:"employee_id"`
	Kind       AccessRequestKind `gorm:"type:varchar(30);default:'website';index" json:"kind"`
	// Resource is what is asked for, in the kind's own terms (see above).
	Resource string `gorm:"index" json:"resource"`
	// Label is how people read it: "LinkedIn", "Visual Studio Code", "invoice.pdf".
	Label string `json:"label"`
	// EventID is the activity row the request was raised from.
	EventID *uuid.UUID `gorm:"type:uuid;index" json:"event_id"`
	// PolicyID and Domain predate kinds; Domain is still set for websites.
	PolicyID   *uuid.UUID          `gorm:"type:uuid;index" json:"policy_id"`
	Domain     string              `gorm:"index" json:"domain"`
	Reason     string              `json:"reason"`
	Status     AccessRequestStatus `gorm:"type:varchar(20);default:'pending';index" json:"status"`
	ReviewedBy *uuid.UUID          `gorm:"type:uuid" json:"reviewed_by"`
	ReviewedAt *time.Time          `json:"reviewed_at"`
	ReviewNote string              `json:"review_note"`

	Employee *Employee `gorm:"foreignKey:EmployeeID;references:ID" json:"employee,omitempty"`
	Policy   *Policy   `gorm:"foreignKey:PolicyID" json:"policy,omitempty"`
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

type AuditLog struct {
	ID         uuid.UUID      `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	OrgID      *uuid.UUID     `gorm:"type:uuid;index" json:"org_id"`
	UserID     *uuid.UUID     `gorm:"type:uuid;index" json:"user_id"`
	Action     string         `gorm:"not null" json:"action"`
	Resource   string         `gorm:"not null" json:"resource"`
	ResourceID *uuid.UUID     `gorm:"type:uuid" json:"resource_id"`
	Changes    map[string]any `gorm:"type:jsonb;serializer:json" json:"changes"`
	IPAddress  string         `json:"ip_address"`
	UserAgent  string         `json:"user_agent"`
	CreatedAt  time.Time      `json:"created_at"`
}

// ─── Platform Settings ─────────────────────────────────────────────────────────

// PlatformSetting is one named, superadmin-editable configuration block —
// "general", "notifications", "security_policy", "data_retention". Stored as
// a free-form JSON blob per key rather than dedicated columns because each
// block's shape is a product decision that will keep changing; the row
// itself is what makes a value durable and superadmin-editable at all.
type PlatformSetting struct {
	Base
	Key       string         `gorm:"uniqueIndex;not null" json:"key"`
	Value     map[string]any `gorm:"type:jsonb;serializer:json" json:"value"`
	UpdatedBy *uuid.UUID     `gorm:"type:uuid" json:"updated_by"`
}

// ─── Billing ────────────────────────────────────────────────────────────────
// One row per invoice/charge a superadmin has raised against an org via
// Razorpay Payment Links — superadmin creates the link, sends it to the
// org's finance contact, and this row tracks it from "created" through
// "paid" (updated by the Razorpay webhook, or a manual refresh poll).

type BillingStatus string

const (
	BillingStatusPending   BillingStatus = "pending"
	BillingStatusPaid      BillingStatus = "paid"
	BillingStatusCancelled BillingStatus = "cancelled"
	BillingStatusExpired   BillingStatus = "expired"
)

type BillingRecord struct {
	Base
	OrgID uuid.UUID `gorm:"type:uuid;not null;index" json:"org_id"`
	Plan  PlanType  `json:"plan"`
	// AmountPaise is the smallest currency unit (paise for INR) — matching
	// what Razorpay's own API takes and returns, so no lossy float money math
	// happens anywhere in this path.
	AmountPaise int64  `gorm:"not null" json:"amount_paise"`
	Currency    string `gorm:"default:'INR'" json:"currency"`
	// monthly | annual | one_time
	BillingCycle string        `json:"billing_cycle"`
	Status       BillingStatus `gorm:"type:varchar(20);default:'pending'" json:"status"`
	Description  string        `json:"description"`

	RazorpayPaymentLinkID string `json:"razorpay_payment_link_id"`
	RazorpayPaymentID     string `json:"razorpay_payment_id"`
	ShortURL              string `json:"short_url"`

	PeriodStart *time.Time `json:"period_start"`
	PeriodEnd   *time.Time `json:"period_end"`
	PaidAt      *time.Time `json:"paid_at"`
	CreatedBy   *uuid.UUID `gorm:"type:uuid" json:"created_by"`

	Org *Organization `gorm:"foreignKey:OrgID" json:"org,omitempty"`
}

// ─── Impersonation ("View as Org") ─────────────────────────────────────────
// A one-time, short-lived code minted by a full-level superadmin and
// consumed by company-dashboard's NextAuth backend to exchange for a real
// session — mirrors the existing social-login exchange (auth.go's
// validInternalSecret path) rather than inventing a new trust mechanism.

type ImpersonationToken struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	Code           string     `gorm:"uniqueIndex;not null" json:"-"`
	TargetUserID   uuid.UUID  `gorm:"type:uuid;not null" json:"target_user_id"`
	ImpersonatorID uuid.UUID  `gorm:"type:uuid;not null" json:"impersonator_id"`
	ExpiresAt      time.Time  `json:"expires_at"`
	ConsumedAt     *time.Time `json:"consumed_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

// ─── Platform Announcements ─────────────────────────────────────────────────

type AnnouncementSeverity string

const (
	AnnouncementInfo     AnnouncementSeverity = "info"
	AnnouncementWarning  AnnouncementSeverity = "warning"
	AnnouncementCritical AnnouncementSeverity = "critical"
)

type Announcement struct {
	Base
	Title    string               `gorm:"not null" json:"title"`
	Body     string               `json:"body"`
	Severity AnnouncementSeverity `gorm:"type:varchar(20);default:'info'" json:"severity"`
	Active   bool                 `gorm:"default:true" json:"active"`
	// A nil StartsAt/EndsAt means "no bound on that side" — active the
	// moment it's created, or indefinitely once started.
	StartsAt  *time.Time `json:"starts_at"`
	EndsAt    *time.Time `json:"ends_at"`
	CreatedBy *uuid.UUID `gorm:"type:uuid" json:"created_by"`
}

// ─── Feature Flags ──────────────────────────────────────────────────────────
// Real, functional rollout infrastructure — not yet wired into any existing
// feature's code path (that's a per-feature follow-up each time one adopts
// it), but genuinely queryable and toggleable per-org today.

type FeatureFlag struct {
	Base
	Key             string `gorm:"uniqueIndex;not null" json:"key"`
	Description     string `json:"description"`
	EnabledGlobally bool   `gorm:"default:false" json:"enabled_globally"`
}

// FeatureFlagOrg is an explicit per-org override — present means "enabled
// for this org" regardless of EnabledGlobally, so a flag can be piloted on
// specific customers before a global flip.
type FeatureFlagOrg struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	FlagID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_flag_org" json:"flag_id"`
	OrgID     uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_flag_org" json:"org_id"`
	CreatedAt time.Time `json:"created_at"`
}

// ─── Support Tickets ─────────────────────────────────────────────────────────

type TicketStatus string
type TicketPriority string

const (
	TicketStatusOpen       TicketStatus = "open"
	TicketStatusInProgress TicketStatus = "in_progress"
	TicketStatusResolved   TicketStatus = "resolved"
	TicketStatusClosed     TicketStatus = "closed"

	TicketPriorityLow    TicketPriority = "low"
	TicketPriorityNormal TicketPriority = "normal"
	TicketPriorityHigh   TicketPriority = "high"
	TicketPriorityUrgent TicketPriority = "urgent"
)

type SupportTicket struct {
	Base
	// OrgID is nil for a ticket a superadmin opens directly (an internal /
	// platform issue) rather than one raised by an org.
	OrgID *uuid.UUID `gorm:"type:uuid;index" json:"org_id"`
	// Number is the customer-facing reference ("DS-1042"). Assigned by the
	// database sequence (see database.MigrateSupportTickets), never by Go.
	Number       int64          `gorm:"->;column:number" json:"number"`
	Subject      string         `gorm:"not null" json:"subject"`
	Category     string         `gorm:"type:varchar(30);default:'other'" json:"category"`
	Status       TicketStatus   `gorm:"type:varchar(20);default:'open'" json:"status"`
	Priority     TicketPriority `gorm:"type:varchar(20);default:'normal'" json:"priority"`
	CreatedByID  uuid.UUID      `gorm:"type:uuid;not null" json:"created_by_id"`
	AssignedToID *uuid.UUID     `gorm:"type:uuid" json:"assigned_to_id"`

	// Conversation state, kept on the ticket so lists don't re-scan messages.
	LastMessageAt   *time.Time `json:"last_message_at"`
	LastMessageSide string     `gorm:"type:varchar(10)" json:"last_message_side"` // customer | support
	CustomerReadAt  *time.Time `json:"customer_read_at"`
	SupportReadAt   *time.Time `json:"support_read_at"`
	ResolvedAt      *time.Time `json:"resolved_at"`
	// Customer feedback once resolved: 1 = solved, -1 = not solved.
	Rating        *int   `json:"rating"`
	RatingComment string `json:"rating_comment"`

	Org *Organization `gorm:"foreignKey:OrgID" json:"org,omitempty"`
}

// Ticket message sides. System entries record status changes in the thread.
const (
	TicketSideCustomer = "customer"
	TicketSideSupport  = "support"
	TicketSideSystem   = "system"
)

// SupportTicketMessage is one entry in a ticket's thread — the ticket's
// original description is just its first message, so there's one shape for
// "what was said" instead of a separate free-text field that duplicates it.
type SupportTicketMessage struct {
	ID       uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	TicketID uuid.UUID `gorm:"type:uuid;not null;index" json:"ticket_id"`
	AuthorID uuid.UUID `gorm:"type:uuid;not null" json:"author_id"`
	Side     string    `gorm:"type:varchar(10);default:'customer'" json:"side"`
	// Internal notes are support-only and never shown or emailed to the org.
	Internal bool `gorm:"default:false" json:"internal"`
	// Source is how the message arrived: "web" (dashboard) or "email" (a
	// reply to a ticket email, see handlers.TicketMailPoller).
	Source    string    `gorm:"type:varchar(10);default:'web'" json:"source"`
	Body      string    `gorm:"not null" json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

// InboundEmail records every email the ticket mailbox poller has looked at,
// keyed by its Message-ID, so a message is never added to a ticket twice and
// ignored mail stays explainable.
type InboundEmail struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	MessageID string     `gorm:"uniqueIndex;not null" json:"message_id"`
	FromAddr  string     `json:"from_addr"`
	TicketID  *uuid.UUID `gorm:"type:uuid;index" json:"ticket_id"`
	Result    string     `json:"result"` // added | ignored: <reason>
	CreatedAt time.Time  `json:"created_at"`
}

// SupportTicketAttachment is a file attached to one message.
type SupportTicketAttachment struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	TicketID    uuid.UUID `gorm:"type:uuid;not null;index" json:"ticket_id"`
	MessageID   uuid.UUID `gorm:"type:uuid;not null;index" json:"message_id"`
	FileName    string    `gorm:"not null" json:"file_name"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	StorageKey  string    `gorm:"not null" json:"-"`
	CreatedAt   time.Time `json:"created_at"`
}

// ─── Demo Requests ───────────────────────────────────────────────────────────
// A "Book a demo" submission from the public marketing website. The website
// posts it server-to-server (see handlers.DemoRequestHandler.Submit); the
// superadmin panel is where the team works through them.

type DemoRequestStatus string

const (
	DemoRequestNew       DemoRequestStatus = "new"
	DemoRequestContacted DemoRequestStatus = "contacted"
	DemoRequestQualified DemoRequestStatus = "qualified"
	DemoRequestClosed    DemoRequestStatus = "closed"
)

type DemoRequest struct {
	Base
	Name      string            `gorm:"not null" json:"name"`
	Email     string            `gorm:"not null;index" json:"email"`
	Company   string            `gorm:"not null" json:"company"`
	Devices   string            `json:"devices"`
	Message   string            `gorm:"type:text" json:"message"`
	Source    string            `json:"source"`
	IPAddress string            `json:"ip_address"`
	UserAgent string            `json:"user_agent"`
	Status    DemoRequestStatus `gorm:"type:varchar(20);default:'new';index" json:"status"`
	Notes     string            `gorm:"type:text" json:"notes"`
	// Set by whichever superadmin last changed the status or notes.
	UpdatedBy *uuid.UUID `gorm:"type:uuid" json:"updated_by"`
}
