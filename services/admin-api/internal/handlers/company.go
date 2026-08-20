package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// CompanyHandler serves the organization's own profile and preferences — the
// company-facing counterpart to the superadmin org endpoints, scoped to the
// caller's own org and never able to reach another one.
type CompanyHandler struct {
	db *gorm.DB
}

func NewCompanyHandler(db *gorm.DB) *CompanyHandler { return &CompanyHandler{db: db} }

// Get handles GET /organization — the company profile plus the read-only facts
// an admin looks for on the same screen (plan, usage, when the trial ends).
func (h *CompanyHandler) Get(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	var employees, devices, teams, policies, users int64
	h.db.Model(&models.Employee{}).Where("org_id = ?", orgID).Count(&employees)
	h.db.Model(&models.Device{}).Where("org_id = ?", orgID).Count(&devices)
	h.db.Model(&models.Team{}).Where("org_id = ?", orgID).Count(&teams)
	h.db.Model(&models.Policy{}).Where("org_id = ?", orgID).Count(&policies)
	h.db.Model(&models.User{}).Where("org_id = ?", orgID).Count(&users)

	c.JSON(http.StatusOK, gin.H{
		"organization": org,
		"usage": gin.H{
			"employees":       employees,
			"devices":         devices,
			"teams":           teams,
			"policies":        policies,
			"dashboard_users": users,
			"max_users":       org.MaxUsers,
		},
		"notification_prefs": models.NotificationPrefsFor(&org),
	})
}

// companyRequest is the editable surface. Slug, plan, status and limits are
// absent on purpose: those are billing and platform concerns, not something an
// org changes about itself.
type companyRequest struct {
	Name               *string `json:"name"`
	LegalName          *string `json:"legal_name"`
	Domain             *string `json:"domain"`
	LogoURL            *string `json:"logo_url"`
	Industry           *string `json:"industry"`
	CompanySize        *string `json:"company_size"`
	Website            *string `json:"website"`
	Phone              *string `json:"phone"`
	ContactEmail       *string `json:"contact_email"`
	ContactName        *string `json:"contact_name"`
	AddressLine1       *string `json:"address_line1"`
	AddressLine2       *string `json:"address_line2"`
	City               *string `json:"city"`
	State              *string `json:"state"`
	PostalCode         *string `json:"postal_code"`
	Country            *string `json:"country"`
	Timezone           *string `json:"timezone"`
	GSTNumber          *string `json:"gst_number"`
	PANNumber          *string `json:"pan_number"`
	RegistrationNumber *string `json:"registration_number"`
	TaxID              *string `json:"tax_id"`
	BillingEmail       *string `json:"billing_email"`
	Notes              *string `json:"notes"`
}

// Update handles PUT /organization
func (h *CompanyHandler) Update(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	var req companyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Pointer fields let a caller clear a value (send "") without every unsent
	// field being wiped to empty — a plain struct can't tell those apart.
	updates := map[string]any{}
	set := func(column string, value *string) {
		if value != nil {
			updates[column] = strings.TrimSpace(*value)
		}
	}

	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Company name cannot be empty"})
			return
		}
		updates["name"] = name
	}
	if req.ContactEmail != nil {
		email := strings.ToLower(strings.TrimSpace(*req.ContactEmail))
		if email != "" && !strings.Contains(email, "@") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Enter a valid contact email"})
			return
		}
		updates["contact_email"] = email
	}

	set("legal_name", req.LegalName)
	set("domain", req.Domain)
	set("logo_url", req.LogoURL)
	set("industry", req.Industry)
	set("company_size", req.CompanySize)
	set("website", req.Website)
	set("phone", req.Phone)
	set("contact_name", req.ContactName)
	set("address_line1", req.AddressLine1)
	set("address_line2", req.AddressLine2)
	set("city", req.City)
	set("state", req.State)
	set("postal_code", req.PostalCode)
	set("country", req.Country)
	set("tax_id", req.TaxID)
	set("notes", req.Notes)
	set("registration_number", req.RegistrationNumber)
	set("billing_email", req.BillingEmail)
	// Registration numbers are quoted case-insensitively everywhere but stored
	// uppercase, which is how GSTIN and PAN are actually issued.
	if req.GSTNumber != nil {
		updates["gst_number"] = strings.ToUpper(strings.TrimSpace(*req.GSTNumber))
	}
	if req.PANNumber != nil {
		updates["pan_number"] = strings.ToUpper(strings.TrimSpace(*req.PANNumber))
	}

	if req.Timezone != nil {
		tz := strings.TrimSpace(*req.Timezone)
		if tz == "" {
			tz = "UTC"
		}
		// A bad timezone would silently skew every scheduled report, so it's
		// validated against the system database rather than trusted.
		if _, err := time.LoadLocation(tz); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown timezone: " + tz})
			return
		}
		updates["timezone"] = tz
	}

	if len(updates) > 0 {
		if err := h.db.Model(&org).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save the company profile"})
			return
		}
	}

	h.db.First(&org, "id = ?", orgID)
	c.JSON(http.StatusOK, gin.H{"organization": org})
}

// UpdateNotifications handles PUT /organization/notifications
func (h *CompanyHandler) UpdateNotifications(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	var req models.NotificationPrefs
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.DigestThreshold < 1 {
		req.DigestThreshold = 1
	}
	if req.DigestThreshold > 500 {
		req.DigestThreshold = 500
	}

	if org.Settings == nil {
		org.Settings = map[string]any{}
	}
	org.Settings["notification_prefs"] = map[string]any{
		"security_alerts":   req.SecurityAlerts,
		"incident_digest":   req.IncidentDigest,
		"digest_threshold":  req.DigestThreshold,
		"weekly_summary":    req.WeeklySummary,
		"inactivity_alerts": req.InactivityAlerts,
		"access_requests":   req.AccessRequests,
		"device_enrolment":  req.DeviceEnrolment,
	}
	if err := h.db.Model(&org).Update("settings", org.Settings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save preferences"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"notification_prefs": req})
}

// Timezones handles GET /organization/timezones — a short, curated list rather
// than all ~600 IANA zones, which is unusable in a dropdown.
func (h *CompanyHandler) Timezones(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"timezones": []string{
		"UTC",
		"Asia/Kolkata", "Asia/Dubai", "Asia/Karachi", "Asia/Dhaka",
		"Asia/Singapore", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Shanghai",
		"Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin",
		"Europe/Madrid", "Europe/Amsterdam", "Europe/Stockholm", "Europe/Moscow",
		"America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
		"America/Toronto", "America/Sao_Paulo", "America/Mexico_City",
		"Australia/Sydney", "Australia/Melbourne", "Pacific/Auckland",
		"Africa/Johannesburg", "Africa/Lagos", "Africa/Cairo",
	}})
}
