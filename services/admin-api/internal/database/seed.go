package database

import (
	"log"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var demoOrgID = uuid.MustParse("11111111-1111-1111-1111-111111111111")

func hashPassword(password string) string {
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}
	return string(hashed)
}

// SeedDevData inserts default development users and reference data if missing.
func SeedDevData(db *gorm.DB) error {
	if err := seedSuperAdmin(db); err != nil {
		return err
	}
	if err := seedDemoOrg(db); err != nil {
		return err
	}
	if err := seedDemoEmployee(db); err != nil {
		return err
	}
	if err := seedURLCategories(db); err != nil {
		return err
	}
	if err := seedDomainRules(db); err != nil {
		return err
	}
	log.Println("✅ Development seed data ready")
	return nil
}

func seedSuperAdmin(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.User{}).Where("email = ?", "superadmin@aavishield.com").Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	user := models.User{
		Email:        "superadmin@aavishield.com",
		PasswordHash: hashPassword("SuperAdmin@123"),
		FirstName:    "Super",
		LastName:     "Admin",
		Role:         models.RoleSuperAdmin,
		Status:       models.StatusActive,
	}
	return db.Create(&user).Error
}

func seedDemoOrg(db *gorm.DB) error {
	var org models.Organization
	err := db.Unscoped().Where("id = ?", demoOrgID).First(&org).Error
	if err == gorm.ErrRecordNotFound {
		org = models.Organization{
			Base:     models.Base{ID: demoOrgID},
			Name:     "Acme Corporation",
			Slug:     "acme",
			Domain:   "acme.com",
			Status:   models.OrgStatusActive,
			Plan:     models.PlanProfessional,
			MaxUsers: 500,
		}
		if err := db.Create(&org).Error; err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else if org.DeletedAt.Valid {
		if err := db.Unscoped().Model(&org).Update("deleted_at", nil).Error; err != nil {
			return err
		}
	}

	var userCount int64
	if err := db.Model(&models.User{}).Where("email = ?", "admin@acme.com").Count(&userCount).Error; err != nil {
		return err
	}
	if userCount > 0 {
		return nil
	}

	orgID := demoOrgID
	user := models.User{
		OrgID:        &orgID,
		Email:        "admin@acme.com",
		PasswordHash: hashPassword("Admin@123"),
		FirstName:    "John",
		LastName:     "Smith",
		Role:         models.RoleOrgAdmin,
		Status:       models.StatusActive,
	}
	return db.Create(&user).Error
}

func seedDemoEmployee(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.Employee{}).Where("org_id = ? AND email = ?", demoOrgID, "employee@acme.com").Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	emp := models.Employee{
		OrgID:              demoOrgID,
		FirstName:          "Jane",
		LastName:           "Doe",
		Email:              "employee@acme.com",
		Department:         "Engineering",
		JobTitle:           "Software Developer",
		Status:             models.StatusActive,
		PortalPasswordHash: hashPassword("Employee@123"),
	}
	return db.Create(&emp).Error
}

func seedURLCategories(db *gorm.DB) error {
	categories := []models.URLCategory{
		{Name: "Social Media", Slug: "social_media", RiskLevel: 2, Color: "#f97316"},
		{Name: "Gambling", Slug: "gambling", RiskLevel: 3, Color: "#ef4444"},
		{Name: "Adult Content", Slug: "adult_content", RiskLevel: 4, Color: "#dc2626"},
		{Name: "Malware", Slug: "malware", RiskLevel: 4, Color: "#991b1b"},
		{Name: "Phishing", Slug: "phishing", RiskLevel: 4, Color: "#7f1d1d"},
		{Name: "News & Media", Slug: "news_media", RiskLevel: 0, Color: "#22c55e"},
		{Name: "Business", Slug: "business", RiskLevel: 0, Color: "#3b82f6"},
		{Name: "Technology", Slug: "technology", RiskLevel: 0, Color: "#6366f1"},
		{Name: "Gaming", Slug: "gaming", RiskLevel: 1, Color: "#f59e0b"},
		{Name: "Streaming", Slug: "streaming", RiskLevel: 1, Color: "#8b5cf6"},
		{Name: "Productivity", Slug: "productivity", RiskLevel: 0, Color: "#10b981"},
		{Name: "Finance", Slug: "finance", RiskLevel: 0, Color: "#14b8a6"},
		{Name: "Healthcare", Slug: "healthcare", RiskLevel: 0, Color: "#06b6d4"},
		{Name: "Education", Slug: "education", RiskLevel: 0, Color: "#0ea5e9"},
		{Name: "Shopping", Slug: "shopping", RiskLevel: 0, Color: "#84cc16"},
		{Name: "Torrent", Slug: "torrent", RiskLevel: 3, Color: "#f43f5e"},
		{Name: "VPN & Proxy", Slug: "vpn_proxy", RiskLevel: 3, Color: "#e11d48"},
		{Name: "Hacking Tools", Slug: "hacking_tools", RiskLevel: 4, Color: "#be123c"},
		{Name: "Unknown", Slug: "unknown", RiskLevel: 1, Color: "#6b7280"},
	}

	for _, category := range categories {
		var count int64
		if err := db.Model(&models.URLCategory{}).Where("slug = ?", category.Slug).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			if err := db.Create(&category).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func seedDomainRules(db *gorm.DB) error {
	rules := []models.DomainRule{
		{Domain: "instagram.com", Action: models.PolicyActionBlock, Category: "social_media", Reason: "Social media", Source: "manual", Enabled: true},
		{Domain: "www.instagram.com", Action: models.PolicyActionBlock, Category: "social_media", Reason: "Social media", Source: "manual", Enabled: true},
		{Domain: "web.whatsapp.com", Action: models.PolicyActionBlock, Category: "social_media", Reason: "Social media", Source: "manual", Enabled: true},
		{Domain: "facebook.com", Action: models.PolicyActionBlock, Category: "social_media", Reason: "Social media", Source: "manual", Enabled: true},
		{Domain: "www.facebook.com", Action: models.PolicyActionBlock, Category: "social_media", Reason: "Social media", Source: "manual", Enabled: true},
		{Domain: "tiktok.com", Action: models.PolicyActionBlock, Category: "social_media", Reason: "Social media", Source: "manual", Enabled: true},
		{Domain: "twitter.com", Action: models.PolicyActionBlock, Category: "social_media", Reason: "Social media", Source: "manual", Enabled: true},
		{Domain: "x.com", Action: models.PolicyActionBlock, Category: "social_media", Reason: "Social media", Source: "manual", Enabled: true},
	}

	for _, rule := range rules {
		var count int64
		if err := db.Model(&models.DomainRule{}).Where("domain = ? AND org_id IS NULL", rule.Domain).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			if err := db.Create(&rule).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
