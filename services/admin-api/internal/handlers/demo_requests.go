package handlers

import (
	"crypto/subtle"
	"log"
	"net/http"
	"net/mail"
	"os"
	"strings"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// DemoRequestHandler receives "Book a demo" submissions from the public
// website and lets superadmins work through them.
type DemoRequestHandler struct {
	db *gorm.DB
}

func NewDemoRequestHandler(db *gorm.DB) *DemoRequestHandler {
	return &DemoRequestHandler{db: db}
}

type demoSubmission struct {
	Name      string `json:"name"`
	Email     string `json:"email"`
	Company   string `json:"company"`
	Devices   string `json:"devices"`
	Message   string `json:"message"`
	Source    string `json:"source"`
	IPAddress string `json:"ip_address"`
	UserAgent string `json:"user_agent"`
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n]
	}
	return s
}

// Submit handles POST /internal/website/demo-requests. Only the website's
// own server calls it, so it is gated on X-Internal-Secret (the same
// INTERNAL_API_SECRET the dashboards' NextAuth backends use) and fails
// closed when that secret is unset.
func (h *DemoRequestHandler) Submit(c *gin.Context) {
	expected := os.Getenv("INTERNAL_API_SECRET")
	got := c.GetHeader("X-Internal-Secret")
	if expected == "" || subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req demoSubmission
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	item := models.DemoRequest{
		Name:      clip(req.Name, 200),
		Email:     strings.ToLower(clip(req.Email, 320)),
		Company:   clip(req.Company, 200),
		Devices:   clip(req.Devices, 50),
		Message:   clip(req.Message, 4000),
		Source:    clip(req.Source, 300),
		IPAddress: clip(req.IPAddress, 64),
		UserAgent: clip(req.UserAgent, 500),
		Status:    models.DemoRequestNew,
	}
	if item.Name == "" || item.Company == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "name and company are required"})
		return
	}
	if addr, err := mail.ParseAddress(item.Email); err != nil || addr.Address != item.Email {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "a valid email is required"})
		return
	}
	if err := h.db.Create(&item).Error; err != nil {
		log.Printf("demo request: save failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save request"})
		return
	}

	mailer.DemoRequestReceived(h.notifyList(), item.Name, item.Email, item.Company, item.Devices, item.Message, item.Source)
	mailer.DemoRequestConfirmation(item.Email, item.Name)

	c.JSON(http.StatusCreated, gin.H{"id": item.ID})
}

// notifyList decides who hears about a new request: LEADS_NOTIFY_EMAIL
// (comma-separated) if set, else the platform team (see teamRecipients).
func (h *DemoRequestHandler) notifyList() []string {
	return teamRecipients(h.db, "LEADS_NOTIFY_EMAIL")
}

// teamRecipients is who on the Aavishield side hears about something: the
// comma-separated addresses in envKey if set, else SUPERADMIN_MAIL, else
// every active superadmin account, so a fresh install still gets the email.
func teamRecipients(db *gorm.DB, envKey string) []string {
	if v := os.Getenv(envKey); v != "" {
		return strings.Split(v, ",")
	}
	if v := mailer.Settings().SuperadminEmail; v != "" {
		return []string{v}
	}
	var emails []string
	db.Model(&models.User{}).
		Where("role = ? AND status = ?", models.RoleSuperAdmin, models.StatusActive).
		Pluck("email", &emails)
	return emails
}

// List handles GET /superadmin/demo-requests?status=&q= with per-status
// counts for the tabs.
func (h *DemoRequestHandler) List(c *gin.Context) {
	q := h.db.Model(&models.DemoRequest{})
	if s := c.Query("status"); s != "" && s != "all" {
		q = q.Where("status = ?", s)
	}
	if term := strings.TrimSpace(c.Query("q")); term != "" {
		like := "%" + strings.ToLower(term) + "%"
		q = q.Where("LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(company) LIKE ?", like, like, like)
	}
	var items []models.DemoRequest
	q.Order("created_at DESC").Limit(500).Find(&items)

	type row struct {
		Status string
		N      int64
	}
	var rows []row
	h.db.Model(&models.DemoRequest{}).Select("status, COUNT(*) AS n").Group("status").Scan(&rows)
	counts := gin.H{"all": int64(0)}
	var total int64
	for _, r := range rows {
		counts[r.Status] = r.N
		total += r.N
	}
	counts["all"] = total

	c.JSON(http.StatusOK, gin.H{"demo_requests": items, "counts": counts})
}

type demoUpdate struct {
	Status *string `json:"status"`
	Notes  *string `json:"notes"`
}

// Update handles PATCH /superadmin/demo-requests/:id (status and/or notes).
func (h *DemoRequestHandler) Update(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var req demoUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	var item models.DemoRequest
	if err := h.db.First(&item, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	changes := map[string]any{}
	if req.Status != nil {
		switch s := models.DemoRequestStatus(*req.Status); s {
		case models.DemoRequestNew, models.DemoRequestContacted, models.DemoRequestQualified, models.DemoRequestClosed:
			changes["status"] = s
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "unknown status"})
			return
		}
	}
	if req.Notes != nil {
		changes["notes"] = clip(*req.Notes, 10000)
	}
	if len(changes) == 0 {
		c.JSON(http.StatusOK, item)
		return
	}
	changes["updated_by"] = currentUserID(c)
	if err := h.db.Model(&item).Updates(changes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
		return
	}
	delete(changes, "notes") // keep free-text notes out of the audit trail
	writeAudit(h.db, c, nil, "update", "demo_request", &item.ID, changes)
	h.db.First(&item, "id = ?", id)
	c.JSON(http.StatusOK, item)
}
