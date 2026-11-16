package database

import (
	"log"

	"gorm.io/gorm"
)

// MigrateOrgStatuses adds the organization statuses that shipped after the
// org_status enum was first created. AutoMigrate never touches enum values.
// Idempotent: IF NOT EXISTS makes re-running a no-op.
func MigrateOrgStatuses(db *gorm.DB) error {
	return db.Exec(`ALTER TYPE org_status ADD VALUE IF NOT EXISTS 'expired'`).Error
}

// MigrateDemoSlotIndex makes a demo slot bookable once: two companies racing
// for the same time can't both pass the clash check, because the second
// insert hits this index. Closed (cancelled or finished) bookings free the
// slot. Failure is logged, not fatal: existing duplicate bookings would stop
// the index being built, and the handler's own clash check still applies.
func MigrateDemoSlotIndex(db *gorm.DB) {
	err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_demo_requests_open_slot
		ON demo_requests (preferred_at)
		WHERE preferred_at IS NOT NULL AND status <> 'closed' AND deleted_at IS NULL`).Error
	if err != nil {
		log.Printf("⚠️  demo slot unique index not created (duplicate open bookings?): %v", err)
	}
}
