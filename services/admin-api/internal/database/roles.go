package database

import "gorm.io/gorm"

// MigrateUserRoles adds the roles that shipped after the user_role enum was
// first created. AutoMigrate never touches enum values, so a new role has to be
// appended here or every insert using it fails with "invalid input value".
//
// Idempotent: IF NOT EXISTS makes re-running a no-op.
func MigrateUserRoles(db *gorm.DB) error {
	return db.Exec(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager'`).Error
}
