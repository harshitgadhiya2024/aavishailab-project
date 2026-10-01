package database

import "gorm.io/gorm"

// MigrateAccessRequests brings requests from before request kinds existed in
// line: they were all websites tied to a policy, so policy_id and domain were
// required. Idempotent: safe to run on every boot.
func MigrateAccessRequests(db *gorm.DB) error {
	for _, stmt := range []string{
		`ALTER TABLE access_requests ALTER COLUMN policy_id DROP NOT NULL`,
		`ALTER TABLE access_requests ALTER COLUMN domain DROP NOT NULL`,
		`UPDATE access_requests SET kind = 'website' WHERE kind IS NULL OR kind = ''`,
		`UPDATE access_requests SET resource = lower(domain) WHERE (resource IS NULL OR resource = '') AND kind = 'website'`,
		`UPDATE access_requests SET label = domain WHERE (label IS NULL OR label = '') AND kind = 'website'`,
	} {
		if err := db.Exec(stmt).Error; err != nil {
			return err
		}
	}
	return nil
}
