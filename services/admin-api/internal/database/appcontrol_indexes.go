package database

import "gorm.io/gorm"

// MigrateAppControlIndexes enforces one rule per (org, application,
// employee) while respecting soft deletes. A plain unique index counts
// deleted rows, so a company that removed an application's rule and then
// added it back would hit a constraint violation on a row it can no longer
// see. The org/team-level rule is the one with no employee.
//
// It also moves rules written before employees had their own rules: a switch
// on one employee's row was saved as {"employee_ids": [that employee]} on the
// one shared rule. Those become that employee's own rule, so each employee's
// block is independent.
//
// Idempotent: safe to run on every boot.
func MigrateAppControlIndexes(db *gorm.DB) error {
	stmts := []string{
		`DROP INDEX IF EXISTS idx_app_rule_org_app`,
		`UPDATE app_control_rules
			SET employee_id = (targets->'employee_ids'->>0)::uuid,
			    targets = jsonb_build_object('scope', 'employee', 'employee_ids', targets->'employee_ids')
			WHERE employee_id IS NULL
			  AND jsonb_typeof(targets) = 'object'
			  AND targets->>'scope' IS NULL
			  AND (CASE WHEN jsonb_typeof(targets->'employee_ids') = 'array'
			            THEN jsonb_array_length(targets->'employee_ids') ELSE 0 END) = 1
			  AND (CASE WHEN jsonb_typeof(targets->'team_ids') = 'array'
			            THEN jsonb_array_length(targets->'team_ids') ELSE 0 END) = 0`,
		`DROP INDEX IF EXISTS idx_app_rule_org_app_live`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_rule_org_app_emp_live
			ON app_control_rules (org_id, application_id, COALESCE(employee_id, '00000000-0000-0000-0000-000000000000'::uuid))
			WHERE deleted_at IS NULL`,
		// One inventory row per (device, application). Same soft-delete caveat
		// as above: an app uninstalled and reinstalled must not collide with
		// the row that recorded the first install.
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_installed_app_device_identifier_live
			ON installed_applications (device_id, identifier)
			WHERE deleted_at IS NULL`,
	}
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			return err
		}
	}
	return nil
}
