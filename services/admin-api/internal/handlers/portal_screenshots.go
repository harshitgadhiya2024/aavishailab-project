package handlers

import (
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Employees see their own screenshots — the same day view the company sees —
// so monitoring is transparent. They can attach a reason to a screenshot
// ("personal call", "researching a vendor") that the company then sees beside
// it. They cannot delete one: there is no delete route on the portal at all,
// and the company's own delete stays behind its monitoring permissions.

const (
	minReasonLen = 3
	maxReasonLen = 500
)

// activePortalEmployee is portalEmployee plus the active-status check: a
// portal token lives for hours, and a deactivated employee must lose access
// straight away rather than when it expires.
func (h *PortalHandler) activePortalEmployee(c *gin.Context) (*models.Employee, bool) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return nil, false
	}
	if emp.Status != "" && emp.Status != "active" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Your account is not active. Contact your IT administrator."})
		return nil, false
	}
	return emp, true
}

// Screenshots handles GET /api/v1/portal/screenshots?date=&tz=&day_reset= —
// the signed-in employee's own day. The employee comes only from the token;
// there is no employee_id parameter to change.
func (h *PortalHandler) Screenshots(c *gin.Context) {
	emp, ok := h.activePortalEmployee(c)
	if !ok {
		return
	}
	c.Header("Cache-Control", "no-store")

	settings := screenshotSettingsFor(h.db, emp.OrgID)
	day, ok := screenshotDay(c, emp.OrgID, emp.ID)
	if !ok {
		return
	}
	day["monitoring"] = gin.H{
		"enabled":        settings.Enabled,
		"blurred":        settings.Blur,
		"retention_days": settings.RetentionDays,
		"min_interval_s": settings.MinIntervalSeconds,
		"max_interval_s": settings.MaxIntervalSeconds,
	}
	// What this person may do here. Spelled out so the page never has to
	// guess, and so "delete" is visibly, deliberately false.
	day["permissions"] = gin.H{"add_reason": true, "delete_screenshot": false, "delete_session": false}
	c.JSON(http.StatusOK, day)
}

// SetScreenshotReason handles PUT /api/v1/portal/screenshots/:id/reason —
// the employee explains one of their own screenshots. Adding or rewording a
// reason is allowed; removing the screenshot is not.
func (h *PortalHandler) SetScreenshotReason(c *gin.Context) {
	emp, ok := h.activePortalEmployee(c)
	if !ok {
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Screenshot not found"})
		return
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Write a short reason"})
		return
	}
	reason := cleanReason(in.Reason)
	if n := len([]rune(reason)); n < minReasonLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Write a short reason (at least 3 characters)"})
		return
	} else if n > maxReasonLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Keep the reason under 500 characters"})
		return
	}

	st, ok := eventStore(c, emp.OrgID.String())
	if !ok {
		return
	}
	now := time.Now()
	found, err := st.SetScreenshotNote(c.Request.Context(), emp.OrgID, emp.ID, id, reason, now)
	if err != nil {
		respondStoreError(c, err)
		return
	}
	if !found {
		// Same answer whether it doesn't exist or belongs to someone else.
		c.JSON(http.StatusNotFound, gin.H{"error": "Screenshot not found"})
		return
	}

	orgID := emp.OrgID
	writeAudit(h.db, c, &orgID, "screenshot_reason", "screenshot", &id, map[string]any{
		"employee_id": emp.ID, "length": len([]rune(reason)),
	})
	c.JSON(http.StatusOK, gin.H{"id": id, "employee_note": reason, "employee_note_at": now})
}

// cleanReason trims the text and drops control characters (keeping ordinary
// line breaks), so a reason renders as plain text wherever it is shown.
func cleanReason(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == '\n' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	return strings.TrimSpace(s)
}
