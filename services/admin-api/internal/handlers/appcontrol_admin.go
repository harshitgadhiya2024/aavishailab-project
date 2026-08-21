package handlers

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/storage"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Superadmin management of the built-in application catalog — the OrgID-NULL
// ManagedApplication rows every organization sees but (per appcontrol.go's
// CreateApplication/DeleteApplication comments) can't edit themselves. Name,
// vendor, category, matching rules, and now a logo all live here.

type AppCatalogAdminHandler struct {
	db    *gorm.DB
	store storage.Backend
}

func NewAppCatalogAdminHandler(db *gorm.DB) *AppCatalogAdminHandler {
	return &AppCatalogAdminHandler{db: db, store: storage.New()}
}

// iconURLTTL is generous (icons are public, unlike screenshots) so the
// dashboard isn't re-signing every app's icon URL on every page load.
const iconURLTTL = 24 * time.Hour

type appCatalogEntry struct {
	models.ManagedApplication
	IconURL string `json:"icon_url,omitempty"`
}

func (h *AppCatalogAdminHandler) withIconURL(app models.ManagedApplication) appCatalogEntry {
	e := appCatalogEntry{ManagedApplication: app}
	if app.IconKey != "" {
		if u, err := h.store.SignedURL(app.IconKey, iconURLTTL); err == nil {
			e.IconURL = u
		}
	}
	return e
}

// List handles GET /superadmin/applications — the full built-in catalog
// (org_id IS NULL only; org-defined apps are that org's own business).
func (h *AppCatalogAdminHandler) List(c *gin.Context) {
	var apps []models.ManagedApplication
	h.db.Where("org_id IS NULL").Order("category ASC, name ASC").Find(&apps)

	out := make([]appCatalogEntry, 0, len(apps))
	for _, a := range apps {
		out = append(out, h.withIconURL(a))
	}
	c.JSON(http.StatusOK, gin.H{"applications": out, "total": len(out)})
}

type appCatalogInput struct {
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

// Create handles POST /superadmin/applications — adds a new built-in
// catalog entry visible to every organization.
func (h *AppCatalogAdminHandler) Create(c *gin.Context) {
	var in appCatalogInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if len(in.ProcessNames) == 0 && len(in.Domains) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Give at least one process name or one domain — otherwise there is nothing to enforce",
		})
		return
	}

	category := strings.TrimSpace(in.Category)
	if category == "" {
		category = "other"
	}
	risk := in.RiskLevel
	if risk <= 0 || risk > 100 {
		risk = 50
	}

	app := models.ManagedApplication{
		OrgID:        nil,
		Name:         name,
		Slug:         slugifyApp(name),
		Vendor:       strings.TrimSpace(in.Vendor),
		Category:     category,
		Description:  strings.TrimSpace(in.Description),
		RiskLevel:    risk,
		ProcessNames: normalizeList(in.ProcessNames),
		BundleIDs:    normalizeList(in.BundleIDs),
		PathPatterns: normalizeList(in.PathPatterns),
		Domains:      normalizeList(in.Domains),
		Source:       "manual",
	}
	if err := h.db.Create(&app).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create the application"})
		return
	}
	c.JSON(http.StatusCreated, h.withIconURL(app))
}

// Update handles PATCH /superadmin/applications/:id — editing an existing
// built-in entry (including renaming it — the per-tenant catalog view has
// no such endpoint at all, by design; this is the only place a shared
// catalog entry can be corrected).
func (h *AppCatalogAdminHandler) Update(c *gin.Context) {
	var app models.ManagedApplication
	if err := h.db.Where("id = ? AND org_id IS NULL", c.Param("id")).First(&app).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Application not found"})
		return
	}

	var in appCatalogInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if name := strings.TrimSpace(in.Name); name != "" {
		app.Name = name
		app.Slug = slugifyApp(name)
	}
	if in.Vendor != "" {
		app.Vendor = strings.TrimSpace(in.Vendor)
	}
	if category := strings.TrimSpace(in.Category); category != "" {
		app.Category = category
	}
	if in.Description != "" {
		app.Description = strings.TrimSpace(in.Description)
	}
	if in.RiskLevel > 0 && in.RiskLevel <= 100 {
		app.RiskLevel = in.RiskLevel
	}
	if in.ProcessNames != nil {
		app.ProcessNames = normalizeList(in.ProcessNames)
	}
	if in.BundleIDs != nil {
		app.BundleIDs = normalizeList(in.BundleIDs)
	}
	if in.PathPatterns != nil {
		app.PathPatterns = normalizeList(in.PathPatterns)
	}
	if in.Domains != nil {
		app.Domains = normalizeList(in.Domains)
	}

	if len(app.ProcessNames) == 0 && len(app.Domains) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "An application needs at least one process name or one domain — otherwise there is nothing to enforce",
		})
		return
	}

	if err := h.db.Save(&app).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update the application"})
		return
	}
	c.JSON(http.StatusOK, h.withIconURL(app))
}

// Delete handles DELETE /superadmin/applications/:id — removes a built-in
// catalog entry, its icon, and every org's rule that referenced it (a rule
// pointing at a deleted application is inert dead weight, same cleanup
// DeleteApplication already does for org-defined apps).
func (h *AppCatalogAdminHandler) Delete(c *gin.Context) {
	var app models.ManagedApplication
	if err := h.db.Where("id = ? AND org_id IS NULL", c.Param("id")).First(&app).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Application not found"})
		return
	}
	h.db.Where("application_id = ?", app.ID).Delete(&models.AppControlRule{})
	if app.IconKey != "" {
		_ = h.store.Delete(app.IconKey) // best-effort — an orphaned object costs nothing a missing icon doesn't
	}
	if err := h.db.Delete(&app).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete the application"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Application deleted"})
}

// maxIconBytes keeps a logo upload to a sane size — this is a UI icon, not a
// document; 512KB is generous for a PNG/SVG/WebP mark.
const maxIconBytes = 512 * 1024

var allowedIconTypes = map[string]string{
	"image/png":     ".png",
	"image/jpeg":    ".jpg",
	"image/svg+xml": ".svg",
	"image/webp":    ".webp",
	"image/x-icon":  ".ico",
}

// UploadIcon handles POST /superadmin/applications/:id/icon — replaces (or
// sets for the first time) an application's logo.
func (h *AppCatalogAdminHandler) UploadIcon(c *gin.Context) {
	var app models.ManagedApplication
	if err := h.db.Where("id = ? AND org_id IS NULL", c.Param("id")).First(&app).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Application not found"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	if fileHeader.Size > maxIconBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "icon must be under 512KB"})
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read upload"})
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxIconBytes+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read upload"})
		return
	}

	contentType := sniffIconType(data)
	ext, ok := allowedIconTypes[contentType]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported image type — use PNG, JPEG, SVG, WebP, or ICO"})
		return
	}

	key := "app-icons/" + app.ID.String() + "-" + strconv.FormatInt(time.Now().UnixNano(), 36) + ext
	if err := h.store.Put(context.Background(), key, contentType, data); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not store icon"})
		return
	}

	oldKey := app.IconKey
	app.IconKey = key
	if err := h.db.Model(&app).Update("icon_key", key).Error; err != nil {
		_ = h.store.Delete(key)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save icon reference"})
		return
	}
	if oldKey != "" && oldKey != key {
		_ = h.store.Delete(oldKey)
	}

	c.JSON(http.StatusOK, h.withIconURL(app))
}

// sniffIconType identifies image bytes by their own magic numbers rather
// than trusting the browser-supplied Content-Type or file extension —
// either can lie, and this decides what actually gets served back out of
// storage.Backend later.
func sniffIconType(data []byte) string {
	switch {
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return "image/png"
	case len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
		return "image/jpeg"
	case len(data) >= 12 && string(data[8:12]) == "WEBP":
		return "image/webp"
	case len(data) >= 4 && data[0] == 0x00 && data[1] == 0x00 && data[2] == 0x01 && data[3] == 0x00:
		return "image/x-icon"
	case looksLikeSVG(data):
		return "image/svg+xml"
	default:
		return http.DetectContentType(data)
	}
}

func looksLikeSVG(data []byte) bool {
	head := strings.ToLower(strings.TrimSpace(string(data[:min(len(data), 256)])))
	return strings.Contains(head, "<svg") || strings.HasPrefix(head, "<?xml")
}
