package models

import (
	"time"

	"github.com/google/uuid"
)

// Data residency ("bring your own storage") lets a company keep everything its
// employees generate — activity and incident logs, DLP findings, work
// sessions, screenshots — in a database and object store it runs itself,
// instead of in Aavishield's.
//
// The split is control plane vs data plane. What stays with Aavishield is what
// the platform needs to run at all: the organization and its dashboard users,
// the employee directory and enrolled devices (agents authenticate against
// them), policies, billing and support tickets. What moves is the data plane —
// the record of what employees did. See internal/dataplane for the routing.
//
// Until a company has both switched the feature on and connected a store, the
// data keeps going to Aavishield's own database and bucket, exactly as before.

// Database engines a company can connect.
const (
	ResidencyDBPostgres  = "postgres"
	ResidencyDBMySQL     = "mysql"
	ResidencyDBMariaDB   = "mariadb"
	ResidencyDBSQLServer = "sqlserver"
	ResidencyDBMongoDB   = "mongodb"
)

// Object stores a company can connect.
const (
	ResidencyFilesS3           = "s3"
	ResidencyFilesR2           = "r2"
	ResidencyFilesGCS          = "gcs"
	ResidencyFilesAzure        = "azure_blob"
	ResidencyFilesS3Compatible = "s3_compatible"
)

// Connection states, shown on the settings page.
const (
	ResidencyStatusNotConfigured = "not_configured"
	ResidencyStatusConnected     = "connected"
	// Configured and in use, but the last health check could not reach it.
	// Data is NOT redirected back to Aavishield while in this state — see
	// dataplane's spool for what happens to new records meanwhile.
	ResidencyStatusUnreachable = "unreachable"
)

// Copying earlier history into a newly connected store.
const (
	ResidencyMigrationIdle    = "idle"
	ResidencyMigrationRunning = "running"
	ResidencyMigrationDone    = "done"
	ResidencyMigrationFailed  = "failed"
)

// OrgDataResidency is one organization's data-residency configuration.
//
// Credentials are sealed with AES-256-GCM (dataplane.Seal) before they reach
// this row and are never serialised back to a browser; *Summary carries the
// non-secret parts (host, bucket, …) the settings page shows instead.
type OrgDataResidency struct {
	Base
	OrgID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"org_id"`
	Enabled bool      `gorm:"default:false" json:"enabled"`

	DBProvider     string         `json:"db_provider"`
	DBConfigSealed string         `json:"-"`
	DBSummary      map[string]any `gorm:"type:jsonb;serializer:json" json:"db_summary"`
	DBStatus       string         `gorm:"default:'not_configured'" json:"db_status"`
	DBError        string         `json:"db_error"`
	DBVerifiedAt   *time.Time     `json:"db_verified_at"`
	DBCheckedAt    *time.Time     `json:"db_checked_at"`

	FilesProvider     string         `json:"files_provider"`
	FilesConfigSealed string         `json:"-"`
	FilesSummary      map[string]any `gorm:"type:jsonb;serializer:json" json:"files_summary"`
	FilesStatus       string         `gorm:"default:'not_configured'" json:"files_status"`
	FilesError        string         `json:"files_error"`
	FilesVerifiedAt   *time.Time     `json:"files_verified_at"`
	FilesCheckedAt    *time.Time     `json:"files_checked_at"`

	MigrationStatus     string         `gorm:"default:'idle'" json:"migration_status"`
	MigrationProgress   map[string]any `gorm:"type:jsonb;serializer:json" json:"migration_progress"`
	MigrationError      string         `json:"migration_error"`
	MigrationStartedAt  *time.Time     `json:"migration_started_at"`
	MigrationFinishedAt *time.Time     `json:"migration_finished_at"`

	UpdatedByID *uuid.UUID `gorm:"type:uuid" json:"updated_by_id"`
}

func (OrgDataResidency) TableName() string { return "org_data_residency" }

// DBActive reports whether employee records belong in the company's database.
func (r *OrgDataResidency) DBActive() bool {
	return r != nil && r.Enabled && r.DBProvider != "" && r.DBConfigSealed != "" &&
		r.DBStatus != ResidencyStatusNotConfigured
}

// FilesActive reports whether screenshots belong in the company's bucket.
func (r *OrgDataResidency) FilesActive() bool {
	return r != nil && r.Enabled && r.FilesProvider != "" && r.FilesConfigSealed != "" &&
		r.FilesStatus != ResidencyStatusNotConfigured
}
