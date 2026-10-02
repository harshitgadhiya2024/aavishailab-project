package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// DataResidencyHandler serves Settings → Data residency: a company keeping
// its employee data in its own database and object storage instead of
// Aavishield's. See models.OrgDataResidency for what moves and what stays,
// and internal/dataplane for how the switch is enforced.
//
// Every save is test-first: a database or bucket is only stored once
// Aavishield has connected to it, created its tables and proved it can read,
// write and delete — so a typo never silently diverts a company's data into
// nowhere. Credentials are sealed before they are written and never sent
// back to a browser.
type DataResidencyHandler struct {
	db *gorm.DB
}

func NewDataResidencyHandler(db *gorm.DB) *DataResidencyHandler {
	return &DataResidencyHandler{db: db}
}

func (h *DataResidencyHandler) load(orgID uuid.UUID) (*models.OrgDataResidency, error) {
	var r models.OrgDataResidency
	err := h.db.Where("org_id = ?", orgID).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		r = models.OrgDataResidency{
			OrgID:           orgID,
			DBStatus:        models.ResidencyStatusNotConfigured,
			FilesStatus:     models.ResidencyStatusNotConfigured,
			MigrationStatus: models.ResidencyMigrationIdle,
		}
		return &r, nil
	}
	return &r, err
}

func (h *DataResidencyHandler) save(c *gin.Context, r *models.OrgDataResidency) error {
	if uid, ok := c.Get(middleware.ContextKeyUserID); ok {
		if id, ok := uid.(uuid.UUID); ok {
			r.UpdatedByID = &id
		}
	}
	err := h.db.Save(r).Error
	dataplane.Invalidate(r.OrgID)
	return err
}

// view is the page's whole state. Never includes a secret.
func (h *DataResidencyHandler) view(c *gin.Context, r *models.OrgDataResidency) gin.H {
	routing := gin.H{
		"database": "aavishield",
		"files":    "aavishield",
	}
	if r.DBActive() {
		routing["database"] = "company"
	}
	if r.FilesActive() {
		routing["files"] = "company"
	}
	var heldEvents int64
	if r.DBActive() {
		heldEvents = dataplane.SpoolDepth(c.Request.Context(), r.OrgID)
	}
	var history int64
	h.db.Model(&models.ActivityEvent{}).Where("org_id = ?", r.OrgID).Count(&history)
	var shots int64
	h.db.Model(&models.Screenshot{}).Where("org_id = ? AND storage_key NOT LIKE ?", r.OrgID, "ext:%").Count(&shots)

	return gin.H{
		"config":  r,
		"routing": routing,
		// What still sits in Aavishield's storage from before the switch.
		"aavishield_history": gin.H{"events": history, "screenshots": shots},
		"held_batches":       heldEvents,
		// The addresses a company's firewall must let in. Set per deployment.
		"egress_ips": splitCSV(os.Getenv("DATA_RESIDENCY_EGRESS_IPS")),
	}
}

// Get handles GET /settings/data-residency.
func (h *DataResidencyHandler) Get(c *gin.Context) {
	r, err := h.load(orgUUID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load data residency settings"})
		return
	}
	c.JSON(http.StatusOK, h.view(c, r))
}

// SetEnabled handles PUT /settings/data-residency — the master switch.
//
// Switching on routes nothing by itself: data keeps going to Aavishield until
// a database or bucket has been connected. Switching off sends new data back
// to Aavishield straight away; what is already in the company's storage stays
// there, untouched, and is no longer shown on the dashboard.
func (h *DataResidencyHandler) SetEnabled(c *gin.Context) {
	var in struct {
		Enabled *bool  `json:"enabled"`
		Confirm string `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Enabled == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enabled is required"})
		return
	}
	orgID := orgUUID(c)
	r, err := h.load(orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load data residency settings"})
		return
	}
	if !*in.Enabled && (r.DBActive() || r.FilesActive()) && in.Confirm != "DISABLE" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": `Type DISABLE to confirm. New employee data will go to Aavishield's storage again, and what is already in your storage will no longer appear on the dashboard.`,
			"code":  "confirmation_required",
		})
		return
	}
	if r.MigrationStatus == models.ResidencyMigrationRunning && !*in.Enabled {
		c.JSON(http.StatusConflict, gin.H{"error": "Wait for the history move to finish before switching this off"})
		return
	}
	r.Enabled = *in.Enabled
	if err := h.save(c, r); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save"})
		return
	}
	writeAudit(h.db, c, &orgID, map[bool]string{true: "enable", false: "disable"}[r.Enabled], "data_residency", &r.ID, nil)
	c.JSON(http.StatusOK, h.view(c, r))
}

// ─── Database ─────────────────────────────────────────────────────────────────

func (h *DataResidencyHandler) dbConfigFromRequest(c *gin.Context, r *models.OrgDataResidency) (*dataplane.DBConfig, bool) {
	var cfg dataplane.DBConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid settings"})
		return nil, false
	}
	cfg.Normalize()
	if r.DBConfigSealed != "" {
		if prev, err := dataplane.UnsealDB(r.DBConfigSealed); err == nil {
			cfg.MergeSecrets(prev)
		}
	}
	if err := cfg.Validate(); err != nil {
		var fe dataplane.FieldErrors
		if errors.As(err, &fe) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Check the highlighted fields", "fields": fe})
			return nil, false
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return nil, false
	}
	return &cfg, true
}

// TestDatabase handles POST /settings/data-residency/database/test.
func (h *DataResidencyHandler) TestDatabase(c *gin.Context) {
	r, err := h.load(orgUUID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load data residency settings"})
		return
	}
	cfg, ok := h.dbConfigFromRequest(c, r)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, dataplane.TestDB(c.Request.Context(), cfg))
}

// SaveDatabase handles PUT /settings/data-residency/database. It runs the
// full test again and saves only if every step passes.
func (h *DataResidencyHandler) SaveDatabase(c *gin.Context) {
	orgID := orgUUID(c)
	r, err := h.load(orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load data residency settings"})
		return
	}
	if !r.Enabled {
		c.JSON(http.StatusConflict, gin.H{"error": "Turn on data residency first"})
		return
	}
	if r.MigrationStatus == models.ResidencyMigrationRunning {
		c.JSON(http.StatusConflict, gin.H{"error": "Wait for the history move to finish before changing the database"})
		return
	}
	cfg, ok := h.dbConfigFromRequest(c, r)
	if !ok {
		return
	}
	check := dataplane.TestDB(c.Request.Context(), cfg)
	if !check.OK {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": check.Error, "check": check})
		return
	}
	raw, _ := json.Marshal(cfg)
	sealed, err := dataplane.Seal(raw)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not secure the credentials"})
		return
	}
	now := time.Now()
	switched := r.DBProvider != "" && r.DBConfigSealed != "" && r.DBProvider != cfg.Provider
	r.DBProvider = cfg.Provider
	r.DBConfigSealed = sealed
	r.DBSummary = cfg.Summary()
	r.DBStatus = models.ResidencyStatusConnected
	r.DBError = ""
	r.DBVerifiedAt, r.DBCheckedAt = &now, &now
	if err := h.save(c, r); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save"})
		return
	}
	writeAudit(h.db, c, &orgID, "connect", "data_residency_database", &r.ID, map[string]any{
		"provider": cfg.Provider, "summary": cfg.Summary(), "replaced_other_engine": switched,
	})
	c.JSON(http.StatusOK, gin.H{"check": check, "state": h.view(c, r)})
}

// DisconnectDatabase handles DELETE /settings/data-residency/database.
func (h *DataResidencyHandler) DisconnectDatabase(c *gin.Context) {
	h.disconnect(c, "database")
}

// ─── Files ────────────────────────────────────────────────────────────────────

func (h *DataResidencyHandler) filesConfigFromRequest(c *gin.Context, r *models.OrgDataResidency) (*dataplane.FilesConfig, bool) {
	var cfg dataplane.FilesConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid settings"})
		return nil, false
	}
	cfg.Normalize()
	if r.FilesConfigSealed != "" {
		if prev, err := dataplane.UnsealFiles(r.FilesConfigSealed); err == nil {
			cfg.MergeSecrets(prev)
		}
	}
	if err := cfg.Validate(); err != nil {
		var fe dataplane.FieldErrors
		if errors.As(err, &fe) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Check the highlighted fields", "fields": fe})
			return nil, false
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return nil, false
	}
	return &cfg, true
}

// TestFiles handles POST /settings/data-residency/files/test.
func (h *DataResidencyHandler) TestFiles(c *gin.Context) {
	r, err := h.load(orgUUID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load data residency settings"})
		return
	}
	cfg, ok := h.filesConfigFromRequest(c, r)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, dataplane.TestFiles(c.Request.Context(), cfg))
}

// SaveFiles handles PUT /settings/data-residency/files.
func (h *DataResidencyHandler) SaveFiles(c *gin.Context) {
	orgID := orgUUID(c)
	r, err := h.load(orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load data residency settings"})
		return
	}
	if !r.Enabled {
		c.JSON(http.StatusConflict, gin.H{"error": "Turn on data residency first"})
		return
	}
	if r.MigrationStatus == models.ResidencyMigrationRunning {
		c.JSON(http.StatusConflict, gin.H{"error": "Wait for the history move to finish before changing file storage"})
		return
	}
	cfg, ok := h.filesConfigFromRequest(c, r)
	if !ok {
		return
	}
	check := dataplane.TestFiles(c.Request.Context(), cfg)
	if !check.OK {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": check.Error, "check": check})
		return
	}
	raw, _ := json.Marshal(cfg)
	sealed, err := dataplane.Seal(raw)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not secure the credentials"})
		return
	}
	now := time.Now()
	r.FilesProvider = cfg.Provider
	r.FilesConfigSealed = sealed
	r.FilesSummary = cfg.Summary()
	r.FilesStatus = models.ResidencyStatusConnected
	r.FilesError = ""
	r.FilesVerifiedAt, r.FilesCheckedAt = &now, &now
	if err := h.save(c, r); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save"})
		return
	}
	writeAudit(h.db, c, &orgID, "connect", "data_residency_files", &r.ID, map[string]any{
		"provider": cfg.Provider, "summary": cfg.Summary(),
	})
	c.JSON(http.StatusOK, gin.H{"check": check, "state": h.view(c, r)})
}

// DisconnectFiles handles DELETE /settings/data-residency/files.
func (h *DataResidencyHandler) DisconnectFiles(c *gin.Context) {
	h.disconnect(c, "files")
}

// disconnect forgets a connection. New data goes to Aavishield again; the
// company's storage and everything in it is left exactly as it is.
func (h *DataResidencyHandler) disconnect(c *gin.Context, kind string) {
	var in struct {
		Confirm string `json:"confirm"`
	}
	_ = c.ShouldBindJSON(&in)
	if strings.TrimSpace(in.Confirm) != "DISCONNECT" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Type DISCONNECT to confirm", "code": "confirmation_required"})
		return
	}
	orgID := orgUUID(c)
	r, err := h.load(orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load data residency settings"})
		return
	}
	if r.MigrationStatus == models.ResidencyMigrationRunning {
		c.JSON(http.StatusConflict, gin.H{"error": "Wait for the history move to finish first"})
		return
	}
	if kind == "database" {
		r.DBProvider, r.DBConfigSealed, r.DBSummary = "", "", nil
		r.DBStatus, r.DBError, r.DBVerifiedAt, r.DBCheckedAt = models.ResidencyStatusNotConfigured, "", nil, nil
	} else {
		r.FilesProvider, r.FilesConfigSealed, r.FilesSummary = "", "", nil
		r.FilesStatus, r.FilesError, r.FilesVerifiedAt, r.FilesCheckedAt = models.ResidencyStatusNotConfigured, "", nil, nil
	}
	if err := h.save(c, r); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save"})
		return
	}
	writeAudit(h.db, c, &orgID, "disconnect", "data_residency_"+kind, &r.ID, nil)
	c.JSON(http.StatusOK, h.view(c, r))
}

// MoveHistory handles POST /settings/data-residency/move-history: copy what
// Aavishield already holds for this org into the company's storage, then
// delete Aavishield's copy.
func (h *DataResidencyHandler) MoveHistory(c *gin.Context) {
	var in struct {
		Confirm string `json:"confirm"`
	}
	_ = c.ShouldBindJSON(&in)
	if strings.TrimSpace(in.Confirm) != "MOVE" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Type MOVE to confirm", "code": "confirmation_required"})
		return
	}
	orgID := orgUUID(c)
	r, err := h.load(orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load data residency settings"})
		return
	}
	if !r.DBActive() && !r.FilesActive() {
		c.JSON(http.StatusConflict, gin.H{"error": "Connect your database or file storage first"})
		return
	}
	if err := dataplane.MoveHistory(orgID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	writeAudit(h.db, c, &orgID, "move_history", "data_residency", &r.ID, nil)
	r, _ = h.load(orgID)
	c.JSON(http.StatusAccepted, h.view(c, r))
}
