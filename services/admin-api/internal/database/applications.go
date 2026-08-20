package database

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/gorm"
)

//go:embed config/applications.json
var applicationsJSON []byte

type applicationConfig struct {
	Slug         string   `json:"slug"`
	Name         string   `json:"name"`
	Vendor       string   `json:"vendor"`
	Category     string   `json:"category"`
	Description  string   `json:"description"`
	RiskLevel    int      `json:"risk_level"`
	ProcessNames []string `json:"process_names"`
	BundleIDs    []string `json:"bundle_ids"`
	PathPatterns []string `json:"path_patterns"`
	Domains      []string `json:"domains"`
}

type applicationsFile struct {
	Applications []applicationConfig `json:"applications"`
}

// SeedApplications loads the built-in application catalog. Like
// SeedDomainCategories this runs on every boot regardless of APP_ENV — an
// organization can't turn on application control for software the catalog
// doesn't know about.
//
// Existing built-in rows are refreshed rather than skipped: a new release that
// adds a domain to an app's bundle (say the vendor moved auth to a new host)
// has to reach organizations that already have a rule for that app, otherwise
// their block quietly develops a hole. Org-defined applications (OrgID set)
// are never touched.
func SeedApplications(db *gorm.DB) error {
	var file applicationsFile
	if err := json.Unmarshal(applicationsJSON, &file); err != nil {
		return fmt.Errorf("failed to parse applications.json: %w", err)
	}

	created, updated := 0, 0
	for _, cfg := range file.Applications {
		app := models.ManagedApplication{
			Name:         cfg.Name,
			Slug:         cfg.Slug,
			Vendor:       cfg.Vendor,
			Category:     cfg.Category,
			Description:  cfg.Description,
			RiskLevel:    cfg.RiskLevel,
			ProcessNames: cfg.ProcessNames,
			BundleIDs:    cfg.BundleIDs,
			PathPatterns: cfg.PathPatterns,
			Domains:      cfg.Domains,
			Source:       "seed",
		}

		var existing models.ManagedApplication
		err := db.Where("slug = ? AND org_id IS NULL", cfg.Slug).First(&existing).Error
		switch {
		case err == gorm.ErrRecordNotFound:
			if err := db.Create(&app).Error; err != nil {
				return fmt.Errorf("failed to create application %q: %w", cfg.Slug, err)
			}
			created++
		case err != nil:
			return fmt.Errorf("failed to look up application %q: %w", cfg.Slug, err)
		default:
			app.ID = existing.ID
			app.CreatedAt = existing.CreatedAt
			if err := db.Model(&existing).Select(
				"name", "vendor", "category", "description", "risk_level",
				"process_names", "bundle_ids", "path_patterns", "domains",
			).Updates(app).Error; err != nil {
				return fmt.Errorf("failed to refresh application %q: %w", cfg.Slug, err)
			}
			updated++
		}
	}

	log.Printf("📦 Application catalog: %d added, %d refreshed (%d total)",
		created, updated, len(file.Applications))
	return nil
}
