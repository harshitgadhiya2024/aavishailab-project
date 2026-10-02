// Package dataplane decides where an organization's employee data lives and
// gives the rest of admin-api one way to read and write it, wherever that is.
//
// "Employee data" here is the data plane: activity and incident events
// (including DLP findings and their evidence), work sessions, and screenshot
// records plus their image files. By default it lives in Aavishield's own
// Postgres and bucket — the primary store. A company that turns on data
// residency and connects its own database and/or bucket gets a tenant store
// instead, and from then on its employee data is written there and read back
// from there; Aavishield's database keeps only the control plane (see
// models.OrgDataResidency).
//
// Handlers never touch the activity_events, work_sessions or screenshots
// tables directly: they ask for the org's Store (Events) and its file Backend
// (Files) and use those. That is what makes the switch total — there is no
// code path left that could quietly write a company's data to the wrong
// place.
package dataplane

import (
	"context"
	"errors"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
)

// Store holds one organization's (or, for the primary store, every
// organization's) employee data.
type Store interface {
	// Kind names the backing engine: "primary", "postgres", "mysql",
	// "mariadb", "sqlserver" or "mongodb".
	Kind() string
	Ping(ctx context.Context) error
	Close() error

	InsertEvents(ctx context.Context, events []*models.ActivityEvent) error
	// UpdateEvent writes the named fields of ev (by column name) back to its row.
	UpdateEvent(ctx context.Context, ev *models.ActivityEvent, fields ...string) error
	FindEvents(ctx context.Context, q EventQuery) ([]models.ActivityEvent, error)
	CountEvents(ctx context.Context, q EventQuery) (int64, error)
	// GroupEvents counts matching events per value of one column, most
	// frequent first. groupBy "" returns a single group covering everything.
	GroupEvents(ctx context.Context, q EventQuery, groupBy string, limit int) ([]EventGroup, error)
	// EachEvent streams every matching event in q's order, in batches, so
	// reports can aggregate in Go without loading a whole period at once.
	EachEvent(ctx context.Context, q EventQuery, fn func(*models.ActivityEvent) error) error
	DeleteEvents(ctx context.Context, q EventQuery) (int64, error)

	InsertSession(ctx context.Context, s *models.WorkSession) error
	// UpdateSessions sets fields on every matching session and bumps
	// updated_at (the staleness signal) unless fields sets it.
	UpdateSessions(ctx context.Context, q SessionQuery, fields map[string]any) (int64, error)
	FindSessions(ctx context.Context, q SessionQuery) ([]models.WorkSession, error)
	DeleteSessions(ctx context.Context, q SessionQuery) (int64, error)

	InsertScreenshot(ctx context.Context, s *models.Screenshot) error
	FindScreenshots(ctx context.Context, q ScreenshotQuery) ([]models.Screenshot, error)
	DeleteScreenshots(ctx context.Context, q ScreenshotQuery) (int64, error)
	// ScreenshotEmployees lists everyone in the org with at least one screenshot.
	ScreenshotEmployees(ctx context.Context, orgID uuid.UUID) ([]uuid.UUID, error)
	// SessionRollup totals a session's screenshots.
	SessionRollup(ctx context.Context, sessionID uuid.UUID) (Rollup, error)
}

// EventClause is one alternative of EventQuery.AnyOf; its non-empty fields
// must all hold.
type EventClause struct {
	EventTypes []string
	Actions    []string
	Categories []string
	// NotCategories matches rows whose category is empty/NULL or not listed.
	NotCategories []string
}

// EventQuery selects activity events. Zero-valued fields don't filter.
type EventQuery struct {
	// OrgID is required except for platform-wide sweeps over the primary store.
	OrgID uuid.UUID
	IDs   []uuid.UUID

	EmployeeID *uuid.UUID
	// RestrictEmployees limits results to EmployeeIn (a manager's teams). An
	// empty EmployeeIn with RestrictEmployees set matches nothing.
	RestrictEmployees bool
	EmployeeIn        []uuid.UUID
	// HasEmployee drops rows with no employee.
	HasEmployee bool

	DeviceID *uuid.UUID
	PolicyID *uuid.UUID

	EventTypes    []string
	Actions       []string
	NotActions    []string
	Categories    []string
	NotCategories []string
	AnyOf         []EventClause

	Since  time.Time // timestamp >= Since
	Before time.Time // timestamp <  Before
	Until  time.Time // timestamp <= Until

	// Search matches SearchFields case-insensitively, as a substring.
	Search       string
	SearchFields []string
	// DomainContainsAny matches target_domain containing any of these
	// (case-insensitive).
	DomainContainsAny []string
	TargetDomain      string
	HasTargetDomain   bool

	DedupeKey string

	// Fields limits which columns are loaded (nil = all).
	Fields []string
	// Oldest first instead of newest first.
	Ascending bool
	Offset    int
	Limit     int
}

// EventGroup is one row of GroupEvents.
type EventGroup struct {
	Key       string
	Count     int64
	Employees int64 // distinct, non-null employee IDs
	RiskSum   float64
	First     *time.Time
	Last      *time.Time
}

// SessionQuery selects work sessions.
type SessionQuery struct {
	OrgID      uuid.UUID
	IDs        []uuid.UUID
	EmployeeID *uuid.UUID
	DeviceID   *uuid.UUID

	// Open: true = still running (ended_at NULL), false = ended.
	Open *bool

	UpdatedSince  time.Time
	UpdatedBefore time.Time
	StartedSince  time.Time
	StartedBefore time.Time
	// ActiveAfter keeps sessions that were still running at that moment:
	// open, or ended at or after it.
	ActiveAfter time.Time
	EndedBefore time.Time
	// NoScreenshots keeps sessions whose rollup counts zero screenshots.
	NoScreenshots bool

	// OrderBy is "started_at" (default, ascending) or "updated_at_desc".
	OrderBy string
	Limit   int
}

// ScreenshotQuery selects screenshot records.
type ScreenshotQuery struct {
	OrgID          uuid.UUID
	IDs            []uuid.UUID
	EmployeeID     *uuid.UUID
	SessionID      *uuid.UUID
	CapturedSince  time.Time
	CapturedBefore time.Time
	// Newest first instead of oldest first.
	Descending bool
	Limit      int
}

// Rollup is a session's screenshot totals.
type Rollup struct {
	Count       int
	Active      int
	Tracked     int
	AvgActivity float64
}

// ErrUnavailable means the organization's own store could not be reached.
// Handlers turn it into a 503 that says so, rather than an empty page that
// looks like data loss.
var ErrUnavailable = errors.New("your company's data store is unreachable")

// Searchable columns. EventQuery.SearchFields is checked against this so a
// caller can never smuggle an expression in as a column name.
var searchableEventFields = map[string]bool{
	"target": true, "target_domain": true, "process_name": true,
	"category": true, "policy_name": true, "operation": true,
}

// Columns GroupEvents may group by.
var groupableEventFields = map[string]bool{
	"": true, "target_domain": true, "category": true, "event_type": true,
	"action": true, "employee_id": true,
}

// Columns UpdateEvent may write.
var updatableEventFields = map[string]bool{
	"metadata": true, "risk_score": true, "target": true, "policy_id": true,
	"policy_name": true, "ai_explanation": true,
}

// Columns UpdateSessions may write.
var updatableSessionFields = map[string]bool{
	"ended_at": true, "screenshot_count": true, "active_seconds": true,
	"tracked_seconds": true, "avg_activity": true, "updated_at": true,
	"project": true, "task": true, "notes": true,
}

// Columns an EventQuery.Fields projection may name.
var eventColumns = []string{
	"id", "org_id", "employee_id", "device_id", "event_type", "action", "target",
	"target_domain", "operation", "category", "process_name", "policy_id",
	"policy_name", "risk_score", "ai_explanation", "ip_address", "geo_country",
	"geo_city", "metadata", "dedupe_key", "timestamp", "created_at",
}

func validEventColumn(c string) bool {
	for _, k := range eventColumns {
		if k == c {
			return true
		}
	}
	return false
}

// withKeyset returns fields that always include the batching key.
func withKeyset(fields []string) []string {
	if len(fields) == 0 {
		return nil
	}
	out := append([]string(nil), fields...)
	have := map[string]bool{}
	for _, f := range out {
		have[f] = true
	}
	for _, k := range []string{"id", "timestamp"} {
		if !have[k] {
			out = append(out, k)
		}
	}
	return out
}

const eachBatch = 2000

func strs[T ~string](in []T) []string {
	out := make([]string, len(in))
	for i, v := range in {
		out[i] = string(v)
	}
	return out
}

// Strings converts typed string enums (EventType, EventAction) for queries.
func Strings[T ~string](in ...T) []string { return strs(in) }
