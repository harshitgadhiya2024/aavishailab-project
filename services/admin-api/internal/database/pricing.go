package database

import (
	"fmt"
	"log"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/gorm"
)

// SeedPricingPlans inserts the launch pricing plans that are missing.
// Like SeedContent it is insert-only: once a plan exists it belongs to the
// superadmin panel, and a redeploy must never revert a price someone set.
func SeedPricingPlans(db *gorm.DB) error {
	created := 0
	for _, p := range models.DefaultPricingPlans {
		var count int64
		if err := db.Model(&models.PricingPlan{}).Where("key = ?", p.Key).Count(&count).Error; err != nil {
			return fmt.Errorf("failed to look up pricing plan %s: %w", p.Key, err)
		}
		if count > 0 {
			continue
		}
		plan := p
		if err := db.Create(&plan).Error; err != nil {
			return fmt.Errorf("failed to create pricing plan %s: %w", p.Key, err)
		}
		created++
	}
	log.Printf("💳 Pricing plans: %d added (%d defaults)", created, len(models.DefaultPricingPlans))
	return nil
}
