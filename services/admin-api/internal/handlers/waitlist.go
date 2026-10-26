package handlers

import (
	"bytes"
	"crypto/subtle"
	"encoding/csv"
	"log"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// WaitlistHandler receives prelaunch sign-ups from the public website's
// /waitlist page and lets superadmins work through them and invite people in.
type WaitlistHandler struct {
	db *gorm.DB
}

func NewWaitlistHandler(db *gorm.DB) *WaitlistHandler {
	return &WaitlistHandler{db: db}
}

type waitlistSubmission struct {
	Name      string `json:"name"`
	Email     string `json:"email"`
	Company   string `json:"company"`
	TeamSize  string `json:"team_size"`
	Role      string `json:"role"`
	Source    string `json:"source"`
	IPAddress string `json:"ip_address"`
	UserAgent string `json:"user_agent"`
}

// Submit handles POST /internal/website/waitlist. Like demo requests, only
// the website's own server calls it, so it is gated on X-Internal-Secret and
// fails closed when that secret is unset.
func (h *WaitlistHandler) Submit(c *gin.Context) {
	expected := os.Getenv("INTERNAL_API_SECRET")
	got := c.GetHeader("X-Internal-Secret")
	if expected == "" || subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req waitlistSubmission
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	item := models.WaitlistEntry{
		Name:      clip(req.Name, 200),
		Email:     strings.ToLower(clip(req.Email, 320)),
		Company:   clip(req.Company, 200),
		TeamSize:  clip(req.TeamSize, 50),
		Role:      clip(req.Role, 100),
		Source:    clip(req.Source, 500),
		IPAddress: clip(req.IPAddress, 64),
		UserAgent: clip(req.UserAgent, 500),
		Status:    models.WaitlistWaiting,
	}
	if item.Name == "" || item.Company == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "name and company are required"})
		return
	}
	if addr, err := mail.ParseAddress(item.Email); err != nil || addr.Address != item.Email {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "a valid email is required"})
		return
	}

	// Joining twice is answered the same way as joining once, so the form
	// can't be used to find out who is already on the list.
	var existing int64
	h.db.Model(&models.WaitlistEntry{}).Where("email = ?", item.Email).Count(&existing)
	if existing > 0 {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}

	if err := h.db.Create(&item).Error; err != nil {
		log.Printf("waitlist: save failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save sign-up"})
		return
	}

	// The team hears about each sign-up only when asked to: a busy launch
	// would otherwise bury the inbox. The list itself is always in superadmin.
	if v := os.Getenv("WAITLIST_NOTIFY_EMAIL"); v != "" {
		mailer.WaitlistJoined(strings.Split(v, ","), item.Name, item.Email, item.Company, item.TeamSize, item.Role, item.Source)
	}
	mailer.WaitlistConfirmation(item.Email, item.Name)

	c.JSON(http.StatusCreated, gin.H{"ok": true})
}

// filtered applies the ?status= and ?q= filters shared by List and Export.
func (h *WaitlistHandler) filtered(c *gin.Context) *gorm.DB {
	q := h.db.Model(&models.WaitlistEntry{})
	if s := c.Query("status"); s != "" && s != "all" {
		q = q.Where("status = ?", s)
	}
	if term := strings.TrimSpace(c.Query("q")); term != "" {
		like := "%" + strings.ToLower(term) + "%"
		q = q.Where("LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(company) LIKE ?", like, like, like)
	}
	return q
}

// List handles GET /superadmin/waitlist?status=&q= with per-status counts
// for the tabs.
func (h *WaitlistHandler) List(c *gin.Context) {
	var items []models.WaitlistEntry
	h.filtered(c).Order("created_at DESC").Limit(1000).Find(&items)

	type row struct {
		Status string
		N      int64
	}
	var rows []row
	h.db.Model(&models.WaitlistEntry{}).Select("status, COUNT(*) AS n").Group("status").Scan(&rows)
	counts := gin.H{}
	var total int64
	for _, r := range rows {
		counts[r.Status] = r.N
		total += r.N
	}
	counts["all"] = total

	c.JSON(http.StatusOK, gin.H{"entries": items, "counts": counts})
}

type waitlistUpdate struct {
	Status *string `json:"status"`
	Notes  *string `json:"notes"`
}

// Update handles PATCH /superadmin/waitlist/:id (status and/or notes). The
// first move to "invited" stamps invited_at and emails the person their
// invitation to create an organization.
func (h *WaitlistHandler) Update(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var req waitlistUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	var item models.WaitlistEntry
	if err := h.db.First(&item, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	changes := map[string]any{}
	invite := false
	if req.Status != nil {
		switch s := models.WaitlistStatus(*req.Status); s {
		case models.WaitlistWaiting, models.WaitlistInvited, models.WaitlistOnboarded, models.WaitlistDeclined:
			changes["status"] = s
			if s == models.WaitlistInvited && item.InvitedAt == nil {
				changes["invited_at"] = time.Now()
				invite = true
			}
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
	if invite {
		mailer.WaitlistInvite(item.Email, item.Name)
	}
	delete(changes, "notes") // keep free-text notes out of the audit trail
	writeAudit(h.db, c, nil, "update", "waitlist_entry", &item.ID, changes)
	h.db.First(&item, "id = ?", id)
	c.JSON(http.StatusOK, item)
}

// Delete handles DELETE /superadmin/waitlist/:id, e.g. a spam sign-up or a
// person asking to be removed.
func (h *WaitlistHandler) Delete(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	res := h.db.Delete(&models.WaitlistEntry{}, "id = ?", id)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete failed"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	writeAudit(h.db, c, nil, "delete", "waitlist_entry", &id, nil)
	c.Status(http.StatusNoContent)
}

// Export handles GET /superadmin/waitlist/export?status=&q=: the same
// filtered list as a CSV for spreadsheets and mail tools.
func (h *WaitlistHandler) Export(c *gin.Context) {
	var items []models.WaitlistEntry
	h.filtered(c).Order("created_at ASC").Find(&items)

	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF") // BOM: Excel otherwise opens UTF-8 names as mojibake
	cw := csv.NewWriter(&buf)
	_ = cw.Write([]string{"Joined", "Name", "Email", "Company", "Team size", "Role", "Status", "Invited", "Source", "Notes"})
	for _, e := range items {
		invited := ""
		if e.InvitedAt != nil {
			invited = e.InvitedAt.UTC().Format("2006-01-02 15:04")
		}
		rec := []string{
			e.CreatedAt.UTC().Format("2006-01-02 15:04"), e.Name, e.Email, e.Company, e.TeamSize, e.Role,
			string(e.Status), invited, e.Source, e.Notes,
		}
		for i := range rec {
			rec[i] = csvSafe(rec[i])
		}
		_ = cw.Write(rec)
	}
	cw.Flush()
	c.Header("Content-Disposition", `attachment; filename="aavishield-waitlist-`+time.Now().UTC().Format("2006-01-02")+`.csv"`)
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}
