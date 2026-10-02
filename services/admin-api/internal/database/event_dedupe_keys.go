package database

import "gorm.io/gorm"

// BackfillEventDedupeKeys copies metadata.dedupe_key into the dedupe_key
// column for rows written before the column existed.
//
// Only the last day matters: the longest fold window is minutes, and the fold
// lookup never looks back further than 24 hours, so older rows can never be
// folded into again. Idempotent and cheap once done — every later boot matches
// nothing.
func BackfillEventDedupeKeys(db *gorm.DB) error {
	return db.Exec(`UPDATE activity_events
		SET dedupe_key = metadata->>'dedupe_key'
		WHERE (dedupe_key IS NULL OR dedupe_key = '')
		  AND timestamp > NOW() - INTERVAL '1 day'
		  AND jsonb_typeof(metadata) = 'object' AND metadata->>'dedupe_key' IS NOT NULL`).Error
}
