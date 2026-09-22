package database

import (
	"log"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/gorm"
)

// migrationKeyScreenshotsDefaultOn marks the one-time flip below as done.
//
// A plain "UPDATE every row" at boot would be wrong: it would run again on
// the next restart and silently undo an admin who had since turned capture
// off. Recording completion in platform_settings makes it genuinely
// once-ever, which is what a default change means — it moves the starting
// point, it does not override a decision somebody has made.
const migrationKeyScreenshotsDefaultOn = "migration.screenshots_default_on"

// MigrateScreenshotsDefaultOn switches existing organizations to the new
// default of screenshot capture being on.
//
// Capture used to be off by default and the consent argument for that now
// lives on device ownership instead (see models.ScreenshotSettings): a
// company-owned machine is watched around the clock, and marking a device
// personal moves it onto a working-hours schedule and gives the employee a
// Disconnect control. New orgs get the new default from the column default;
// this is what brings orgs created before the change into line with it.
//
// Idempotent: the platform-setting marker means a second call is a no-op.
func MigrateScreenshotsDefaultOn(db *gorm.DB) error {
	var marker models.PlatformSetting
	err := db.Where("key = ?", migrationKeyScreenshotsDefaultOn).First(&marker).Error
	if err == nil {
		return nil // already applied
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}

	result := db.Model(&models.ScreenshotSettings{}).
		Where("enabled = ?", false).
		Update("enabled", true)
	if result.Error != nil {
		return result.Error
	}

	if err := db.Create(&models.PlatformSetting{
		Key:   migrationKeyScreenshotsDefaultOn,
		Value: map[string]any{"organizations_updated": result.RowsAffected},
	}).Error; err != nil {
		return err
	}

	if result.RowsAffected > 0 {
		log.Printf("✅ Screenshot capture enabled for %d existing organization(s)", result.RowsAffected)
	}
	return nil
}
