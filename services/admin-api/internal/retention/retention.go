// Package retention enforces the "data_retention" platform setting — before
// this existed, ActivityEvent and AuditLog rows accumulated forever with no
// way to bound storage growth or satisfy a retention policy an org (or an
// auditor) might expect.
package retention

import (
	"log"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/gorm"
)

const (
	defaultActivityDays = 180
	defaultAuditDays    = 365
	// A day is swept at most once — the interval a caller passes to Start is
	// clamped up to this, so a misconfigured short interval can't turn a bulk
	// delete into a busy loop against Postgres.
	minSweepInterval = 1 * time.Hour
)

// daysFromSettings reads activity_log_days / audit_log_days out of a
// data_retention settings value, falling back to the defaults for a
// missing key or a value that isn't a sane positive number — a
// misconfigured or unset setting should never turn into "delete everything"
// (0 or negative days) or "delete nothing silently" via a type panic.
func daysFromSettings(value map[string]any) (activityDays, auditDays int) {
	activityDays, auditDays = defaultActivityDays, defaultAuditDays
	if v, ok := numberField(value, "activity_log_days"); ok && v > 0 {
		activityDays = v
	}
	if v, ok := numberField(value, "audit_log_days"); ok && v > 0 {
		auditDays = v
	}
	return activityDays, auditDays
}

// numberField reads a numeric field out of a JSON-decoded map, tolerating
// both the float64 shape json.Unmarshal produces and a plain int a caller
// (e.g. a test) might set directly.
func numberField(m map[string]any, key string) (int, bool) {
	switch v := m[key].(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	}
	return 0, false
}

// Sweep deletes ActivityEvent and AuditLog rows older than the configured
// retention windows and returns how many rows of each were removed.
func Sweep(db *gorm.DB) (activityDeleted, auditDeleted int64, err error) {
	var setting models.PlatformSetting
	value := map[string]any{}
	if err := db.Where("key = ?", "data_retention").First(&setting).Error; err == nil {
		value = setting.Value
	}
	activityDays, auditDays := daysFromSettings(value)

	activityCutoff := time.Now().AddDate(0, 0, -activityDays)
	res := db.Unscoped().Where("timestamp < ?", activityCutoff).Delete(&models.ActivityEvent{})
	if res.Error != nil {
		return 0, 0, res.Error
	}
	activityDeleted = res.RowsAffected

	auditCutoff := time.Now().AddDate(0, 0, -auditDays)
	res = db.Where("created_at < ?", auditCutoff).Delete(&models.AuditLog{})
	if res.Error != nil {
		return activityDeleted, 0, res.Error
	}
	auditDeleted = res.RowsAffected

	return activityDeleted, auditDeleted, nil
}

// StartDataRetentionSweep runs Sweep once shortly after startup (so it never
// races AutoMigrate) and then on a fixed interval, in its own goroutine —
// matching handlers.StartScreenshotRetentionSweep's shape, so callers don't
// need to remember which retention loops manage their own goroutine.
func StartDataRetentionSweep(db *gorm.DB, interval time.Duration) {
	if interval < minSweepInterval {
		interval = minSweepInterval
	}
	go func() {
		time.Sleep(30 * time.Second)
		sweepOnce(db)

		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			sweepOnce(db)
		}
	}()
}

func sweepOnce(db *gorm.DB) {
	activityDeleted, auditDeleted, err := Sweep(db)
	if err != nil {
		log.Printf("retention: sweep failed: %v", err)
		return
	}
	if activityDeleted > 0 || auditDeleted > 0 {
		log.Printf("retention: swept %d activity events, %d audit log rows past their retention window",
			activityDeleted, auditDeleted)
	}
}
