package database

import "gorm.io/gorm"

// MigrateCategoryDomainIndexes replaces the original unique index on
// category_domains(category_id, domain) — which predates per-org domains and
// would stop two companies from adding the same domain to the same category —
// with a pair of partial unique indexes: one for the shared seed rows
// (org_id IS NULL), one scoped per organization. AutoMigrate only ever adds
// indexes, so the old one has to be dropped explicitly here.
//
// Idempotent: safe to run on every boot.
func MigrateCategoryDomainIndexes(db *gorm.DB) error {
	stmts := []string{
		`DROP INDEX IF EXISTS idx_category_domain`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_category_domain_global
			ON category_domains (category_id, domain)
			WHERE org_id IS NULL AND deleted_at IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_category_domain_org
			ON category_domains (category_id, domain, org_id)
			WHERE org_id IS NOT NULL AND deleted_at IS NULL`,
	}
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			return err
		}
	}
	return nil
}
