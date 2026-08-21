package handlers

import (
	"net/http"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PlatformSettingsHandler serves the 4 platform-wide config blocks the
// superadmin Settings page originally shipped as "Coming soon" placeholders
// for: general, notifications, security_policy, data_retention.
type PlatformSettingsHandler struct {
	db *gorm.DB
}

func NewPlatformSettingsHandler(db *gorm.DB) *PlatformSettingsHandler {
	return &PlatformSettingsHandler{db: db}
}

// settingKeys is the fixed set of editable blocks — anything else 404s
// rather than letting the settings table become an arbitrary key-value blob.
var settingKeys = map[string]bool{
	"general":         true,
	"notifications":   true,
	"security_policy": true,
	"data_retention":  true,
}

// settingDefaults is what a key reads as before any superadmin has ever
// saved it — real, usable defaults rather than an empty object, since
// data_retention in particular is read by the retention sweep whether or
// not a row exists yet.
var settingDefaults = map[string]map[string]any{
	"general": {
		"platform_name":  "Aavishield",
		"support_email":  "support@aavishield.com",
		"default_timezone": "UTC",
	},
	"notifications": {
		"seat_limit_alert_threshold_pct": 80,
		"email_digest":                   "daily",
		"webhook_url":                    "",
	},
	"security_policy": {
		"default_session_timeout_minutes": 60,
		"default_password_min_length":     8,
		"require_mfa_for_org_admins":      false,
	},
	"data_retention": {
		"activity_log_days": 180,
		"audit_log_days":    365,
	},
}

// Get handles GET /superadmin/settings — all 4 blocks in one response,
// each merged over its defaults so a never-saved key still reads as
// something meaningful rather than null.
func (h *PlatformSettingsHandler) Get(c *gin.Context) {
	var rows []models.PlatformSetting
	h.db.Find(&rows)

	saved := map[string]map[string]any{}
	for _, r := range rows {
		saved[r.Key] = r.Value
	}

	out := map[string]any{}
	for key, def := range settingDefaults {
		merged := map[string]any{}
		for k, v := range def {
			merged[k] = v
		}
		for k, v := range saved[key] {
			merged[k] = v
		}
		out[key] = merged
	}
	c.JSON(http.StatusOK, out)
}

// Update handles PUT /superadmin/settings/:key — upserts one block.
// SuperAdminFullOnly at the router: settings are platform-wide, so a
// support-level account shouldn't be able to change them for everyone.
func (h *PlatformSettingsHandler) Update(c *gin.Context) {
	key := c.Param("key")
	if !settingKeys[key] {
		c.JSON(http.StatusNotFound, gin.H{"error": "Unknown settings key"})
		return
	}

	var value map[string]any
	if err := c.ShouldBindJSON(&value); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	uid := currentUserID(c)
	var existing models.PlatformSetting
	err := h.db.Where("key = ?", key).First(&existing).Error
	if err == nil {
		h.db.Model(&existing).Updates(map[string]any{"value": value, "updated_by": uid})
	} else {
		h.db.Create(&models.PlatformSetting{Key: key, Value: value, UpdatedBy: uid})
	}

	writeAudit(h.db, c, nil, "update", "platform_settings", nil, map[string]any{"key": key})

	// Re-read merged-over-defaults so the response matches what Get() would
	// return for this key.
	merged := map[string]any{}
	for k, v := range settingDefaults[key] {
		merged[k] = v
	}
	for k, v := range value {
		merged[k] = v
	}
	c.JSON(http.StatusOK, merged)
}
