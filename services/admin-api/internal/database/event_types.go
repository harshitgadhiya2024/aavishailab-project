package database

import "gorm.io/gorm"

// MigrateEventTypes adds the device-lifecycle event types that shipped after
// the event_type enum was first created. AutoMigrate never touches enum
// values, so a new one has to be appended here or every insert using it fails
// with "invalid input value" — the same reason MigrateUserRoles exists.
//
// These three are what the company sees on the Devices activity view: an
// employee connecting the connector, disconnecting it, and removing it.
// Idempotent: IF NOT EXISTS makes re-running a no-op.
func MigrateEventTypes(db *gorm.DB) error {
	for _, v := range []string{
		"device_connect",
		"device_disconnect",
		"device_uninstall",
	} {
		// ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
		// older PostgreSQL, and gorm's Exec doesn't wrap DDL in one, so these
		// run as individual statements on purpose.
		if err := db.Exec(`ALTER TYPE event_type ADD VALUE IF NOT EXISTS ?`, gorm.Expr("'"+v+"'")).Error; err != nil {
			return err
		}
	}
	return nil
}
