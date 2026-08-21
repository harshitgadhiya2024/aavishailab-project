package handlers

import (
	"net/http"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AnnouncementHandler lets a superadmin broadcast a message — maintenance
// windows, incidents, new features — to every org's dashboard, without
// sending an email to each one individually.
type AnnouncementHandler struct {
	db *gorm.DB
}

func NewAnnouncementHandler(db *gorm.DB) *AnnouncementHandler {
	return &AnnouncementHandler{db: db}
}

// List handles GET /superadmin/announcements — every announcement, active
// or not, for the management view.
func (h *AnnouncementHandler) List(c *gin.Context) {
	var items []models.Announcement
	h.db.Order("created_at DESC").Find(&items)
	c.JSON(http.StatusOK, gin.H{"announcements": items, "total": len(items)})
}

type announcementRequest struct {
	Title    string  `json:"title" binding:"required"`
	Body     string  `json:"body"`
	Severity string  `json:"severity"`
	Active   *bool   `json:"active"`
	StartsAt *string `json:"starts_at"`
	EndsAt   *string `json:"ends_at"`
}

func (r *announcementRequest) severity() models.AnnouncementSeverity {
	switch models.AnnouncementSeverity(r.Severity) {
	case models.AnnouncementWarning:
		return models.AnnouncementWarning
	case models.AnnouncementCritical:
		return models.AnnouncementCritical
	default:
		return models.AnnouncementInfo
	}
}

// Create handles POST /superadmin/announcements
func (h *AnnouncementHandler) Create(c *gin.Context) {
	var req announcementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	item := models.Announcement{
		Title:     req.Title,
		Body:      req.Body,
		Severity:  req.severity(),
		Active:    active,
		StartsAt:  parseOptionalDateTime(req.StartsAt),
		EndsAt:    parseOptionalDateTime(req.EndsAt),
		CreatedBy: currentUserID(c),
	}
	if err := h.db.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create announcement"})
		return
	}
	writeAudit(h.db, c, nil, "create", "announcement", &item.ID, map[string]any{"title": item.Title})
	c.JSON(http.StatusCreated, item)
}

func parseOptionalDateTime(s *string) *time.Time {
	if s == nil || *s == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, *s); err == nil {
		return &t
	}
	if t, err := time.Parse("2006-01-02", *s); err == nil {
		return &t
	}
	return nil
}

// Update handles PATCH /superadmin/announcements/:id
func (h *AnnouncementHandler) Update(c *gin.Context) {
	var item models.Announcement
	if err := h.db.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Announcement not found"})
		return
	}
	var req announcementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updates := map[string]any{
		"title": req.Title, "body": req.Body, "severity": req.severity(),
		"starts_at": parseOptionalDateTime(req.StartsAt), "ends_at": parseOptionalDateTime(req.EndsAt),
	}
	if req.Active != nil {
		updates["active"] = *req.Active
	}
	h.db.Model(&item).Updates(updates)
	writeAudit(h.db, c, nil, "update", "announcement", &item.ID, nil)
	c.JSON(http.StatusOK, item)
}

// Delete handles DELETE /superadmin/announcements/:id
func (h *AnnouncementHandler) Delete(c *gin.Context) {
	result := h.db.Delete(&models.Announcement{}, "id = ?", c.Param("id"))
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Announcement not found"})
		return
	}
	writeAudit(h.db, c, nil, "delete", "announcement", nil, nil)
	c.JSON(http.StatusOK, gin.H{"message": "Announcement deleted"})
}

// Active handles GET /announcements/active — the read the company-dashboard
// (and, later, any other authenticated frontend) polls to render a banner.
// Requires only AuthRequired, not any specific role: every signed-in user
// should see a platform-wide incident notice.
func (h *AnnouncementHandler) Active(c *gin.Context) {
	now := time.Now()
	var items []models.Announcement
	h.db.Where("active = true AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)", now, now).
		Order("severity DESC, created_at DESC").
		Find(&items)
	c.JSON(http.StatusOK, gin.H{"announcements": items})
}
