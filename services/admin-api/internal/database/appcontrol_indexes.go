package database

import "gorm.io/gorm"

// MigrateAppControlIndexes enforces one rule per (org, application) while
// respecting soft deletes. A plain unique index counts deleted rows, so a
// company that removed an application's rule and then added it back would hit
// a constraint violation on a row it can no longer see.
//
// Idempotent: safe to run on every boot.
func MigrateAppControlIndexes(db *gorm.DB) error {
	stmts := []string{
		`DROP INDEX IF EXISTS idx_app_rule_org_app`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_rule_org_app_live
			ON app_control_rules (org_id, application_id)
			WHERE deleted_at IS NULL`,
	}
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			return err
		}
	}
	return nil
}
