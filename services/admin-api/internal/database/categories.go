package database

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/gorm"
)

//go:embed config/domain_categories.json
var domainCategoriesJSON []byte

type categoryConfig struct {
	Slug        string   `json:"slug"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	RiskLevel   int      `json:"risk_level"`
	Color       string   `json:"color"`
	Domains     []string `json:"domains"`
}

type domainCategoriesFile struct {
	Categories []categoryConfig `json:"categories"`
}

// SeedDomainCategories loads internal/database/config/domain_categories.json
// and upserts each category (find-or-create by slug, so it merges cleanly
// with whatever seedURLCategories in seed.go already created in dev) plus
// its member domains into category_domains. Unlike SeedDevData, this runs
// unconditionally on every boot regardless of APP_ENV — category-based
// policy blocking needs this data to exist in production too, not just for
// local development.
func SeedDomainCategories(db *gorm.DB) error {
	var file domainCategoriesFile
	if err := json.Unmarshal(domainCategoriesJSON, &file); err != nil {
		return fmt.Errorf("failed to parse domain_categories.json: %w", err)
	}

	domainCount := 0
	for _, cfg := range file.Categories {
		var category models.URLCategory
		err := db.Where("slug = ?", cfg.Slug).First(&category).Error
		if err == gorm.ErrRecordNotFound {
			category = models.URLCategory{
				Name:        cfg.Name,
				Slug:        cfg.Slug,
				Description: cfg.Description,
				RiskLevel:   cfg.RiskLevel,
				Color:       cfg.Color,
			}
			if err := db.Create(&category).Error; err != nil {
				return fmt.Errorf("failed to create category %q: %w", cfg.Slug, err)
			}
		} else if err != nil {
			return fmt.Errorf("failed to look up category %q: %w", cfg.Slug, err)
		}

		for _, domain := range cfg.Domains {
			var count int64
			if err := db.Model(&models.CategoryDomain{}).
				Where("category_id = ? AND domain = ? AND org_id IS NULL", category.ID, domain).
				Count(&count).Error; err != nil {
				return fmt.Errorf("failed to check category domain %q: %w", domain, err)
			}
			if count == 0 {
				if err := db.Create(&models.CategoryDomain{
					CategoryID: category.ID,
					Domain:     domain,
					Source:     "seed",
				}).Error; err != nil {
					return fmt.Errorf("failed to seed category domain %q: %w", domain, err)
				}
				domainCount++
			}
		}
	}

	if domainCount > 0 {
		log.Printf("✅ Seeded %d new category domain(s) across %d categories", domainCount, len(file.Categories))
	}
	return nil
}
