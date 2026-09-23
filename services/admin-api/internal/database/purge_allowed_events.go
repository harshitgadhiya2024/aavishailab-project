package database

import (
	"log"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/gorm"
)

// purgeAllowedBatchSize bounds each DELETE so a deployment carrying millions
// of historical rows does not take one long lock on activity_events at boot
// while the API is already serving. Each batch is its own transaction, so an
// interrupted purge simply resumes on the next start.
const purgeAllowedBatchSize = 10000

// PurgeAllowedEvents deletes every "allowed" activity row.
//
// Allowed traffic is not part of this product: both connectors refuse to send
// it, every write path drops it (see dropAllowedEvents), and every read path
// excludes it. What remains is history — rows written before those guards
// existed. Leaving them on disk would mean the requirement ("allowed logs
// store bhi nahi karna") is only true going forward, and any query that ever
// forgot its filter would quietly start showing them again.
//
// Deliberately NOT marked done-once in platform_settings, unlike
// MigrateScreenshotsDefaultOn. That marker exists there to avoid overriding a
// choice an admin made later; here there is no choice to preserve. Running
// every boot makes this self-healing: a device still on an old connector that
// somehow reaches an unpatched write path cannot accumulate rows for longer
// than one restart. The action column is indexed, so the no-op case — which
// is every boot after the first — costs one index probe.
func PurgeAllowedEvents(db *gorm.DB) error {
	var deleted int64
	for {
		// Delete by primary key from a bounded subquery rather than
		// `DELETE ... LIMIT`, which Postgres does not support.
		result := db.Exec(`
			DELETE FROM activity_events
			WHERE id IN (
				SELECT id FROM activity_events WHERE action = ? LIMIT ?
			)`, models.EventActionAllowed, purgeAllowedBatchSize)
		if result.Error != nil {
			return result.Error
		}
		deleted += result.RowsAffected
		if result.RowsAffected < purgeAllowedBatchSize {
			break
		}
	}

	if deleted > 0 {
		log.Printf("✅ Purged %d historical \"allowed\" activity event(s)", deleted)
	}
	return nil
}
