package handlers

import (
	"net/http"
	"strings"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// FeatureFlagHandler manages rollout flags — real, queryable infrastructure
// (IsEnabled, below, is what a future feature's code would call) even
// though nothing in the codebase reads a flag yet. Wiring a specific
// feature behind one is that feature's own follow-up.
type FeatureFlagHandler struct {
	db *gorm.DB
}

func NewFeatureFlagHandler(db *gorm.DB) *FeatureFlagHandler {
	return &FeatureFlagHandler{db: db}
}

type featureFlagEntry struct {
	models.FeatureFlag
	OrgIDs []uuid.UUID `json:"org_ids"`
}

// List handles GET /superadmin/feature-flags
func (h *FeatureFlagHandler) List(c *gin.Context) {
	var flags []models.FeatureFlag
	h.db.Order("key ASC").Find(&flags)

	out := make([]featureFlagEntry, 0, len(flags))
	for _, f := range flags {
		var overrides []models.FeatureFlagOrg
		h.db.Where("flag_id = ?", f.ID).Find(&overrides)
		orgIDs := make([]uuid.UUID, 0, len(overrides))
		for _, o := range overrides {
			orgIDs = append(orgIDs, o.OrgID)
		}
		out = append(out, featureFlagEntry{FeatureFlag: f, OrgIDs: orgIDs})
	}
	c.JSON(http.StatusOK, gin.H{"flags": out, "total": len(out)})
}

type featureFlagRequest struct {
	Key             string `json:"key" binding:"required"`
	Description     string `json:"description"`
	EnabledGlobally bool   `json:"enabled_globally"`
}

// Create handles POST /superadmin/feature-flags
func (h *FeatureFlagHandler) Create(c *gin.Context) {
	var req featureFlagRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	key := strings.ToLower(strings.TrimSpace(req.Key))
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}
	flag := models.FeatureFlag{Key: key, Description: req.Description, EnabledGlobally: req.EnabledGlobally}
	if err := h.db.Create(&flag).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "A flag with that key already exists"})
		return
	}
	writeAudit(h.db, c, nil, "create", "feature_flag", &flag.ID, map[string]any{"key": key})
	c.JSON(http.StatusCreated, flag)
}

// Update handles PATCH /superadmin/feature-flags/:id — toggles
// enabled_globally and/or edits the description.
func (h *FeatureFlagHandler) Update(c *gin.Context) {
	var flag models.FeatureFlag
	if err := h.db.First(&flag, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Flag not found"})
		return
	}
	var req struct {
		Description     *string `json:"description"`
		EnabledGlobally *bool   `json:"enabled_globally"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updates := map[string]any{}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.EnabledGlobally != nil {
		updates["enabled_globally"] = *req.EnabledGlobally
	}
	if len(updates) > 0 {
		h.db.Model(&flag).Updates(updates)
	}
	writeAudit(h.db, c, nil, "update", "feature_flag", &flag.ID, updates)
	c.JSON(http.StatusOK, flag)
}

// Delete handles DELETE /superadmin/feature-flags/:id
func (h *FeatureFlagHandler) Delete(c *gin.Context) {
	flagID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad flag id"})
		return
	}
	h.db.Where("flag_id = ?", flagID).Delete(&models.FeatureFlagOrg{})
	result := h.db.Delete(&models.FeatureFlag{}, "id = ?", flagID)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Flag not found"})
		return
	}
	writeAudit(h.db, c, nil, "delete", "feature_flag", &flagID, nil)
	c.JSON(http.StatusOK, gin.H{"message": "Flag deleted"})
}

// SetOrgOverride handles PUT /superadmin/feature-flags/:id/orgs/:org_id and
// DELETE of the same path — add or remove one org's explicit override.
func (h *FeatureFlagHandler) SetOrgOverride(c *gin.Context) {
	flagID, err1 := uuid.Parse(c.Param("id"))
	orgID, err2 := uuid.Parse(c.Param("org_id"))
	if err1 != nil || err2 != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var flag models.FeatureFlag
	if err := h.db.First(&flag, "id = ?", flagID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Flag not found"})
		return
	}
	h.db.Where("flag_id = ? AND org_id = ?", flagID, orgID).
		FirstOrCreate(&models.FeatureFlagOrg{FlagID: flagID, OrgID: orgID})
	writeAudit(h.db, c, &orgID, "enable_for_org", "feature_flag", &flagID, nil)
	c.JSON(http.StatusOK, gin.H{"message": "Enabled for organization"})
}

func (h *FeatureFlagHandler) RemoveOrgOverride(c *gin.Context) {
	flagID, err1 := uuid.Parse(c.Param("id"))
	orgID, err2 := uuid.Parse(c.Param("org_id"))
	if err1 != nil || err2 != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	h.db.Where("flag_id = ? AND org_id = ?", flagID, orgID).Delete(&models.FeatureFlagOrg{})
	writeAudit(h.db, c, &orgID, "disable_for_org", "feature_flag", &flagID, nil)
	c.JSON(http.StatusOK, gin.H{"message": "Override removed"})
}

// IsEnabled is what a future gated feature would call: true if the flag is
// on for everyone, or explicitly turned on for this org.
func IsEnabled(db *gorm.DB, key string, orgID uuid.UUID) bool {
	var flag models.FeatureFlag
	if err := db.Where("key = ?", key).First(&flag).Error; err != nil {
		return false
	}
	if flag.EnabledGlobally {
		return true
	}
	var count int64
	db.Model(&models.FeatureFlagOrg{}).Where("flag_id = ? AND org_id = ?", flag.ID, orgID).Count(&count)
	return count > 0
}
