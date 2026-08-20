package handlers

import (
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/storage"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type MonitoringHandler struct {
	db    *gorm.DB
	store storage.Backend
}

func NewMonitoringHandler(db *gorm.DB) *MonitoringHandler {
	return &MonitoringHandler{db: db, store: storage.New()}
}

// ─── small parsing helpers (shared with the ingest handler) ──────────────────

func readLimited(r io.Reader, max int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, io.ErrShortBuffer
	}
	return data, nil
}

func parseTimeOr(v string, fallback time.Time) time.Time {
	if v == "" {
		return fallback
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t
	}
	return fallback
}

func atoiOr(v string, fallback int) int {
	if n, err := strconv.Atoi(v); err == nil {
		return n
	}
	return fallback
}

func clampPercent(p int) int {
	if p < 0 {
		return 0
	}
	if p > 100 {
		return 100
	}
	return p
}

// hasPerm reports whether the caller's role carries a permission — used to tell
// the screenshot UI which delete buttons to show, mirroring how the reference
// screen prints "Delete Session: Allowed / Delete Screenshot: Denied".
func hasPerm(c *gin.Context, perm string) bool {
	raw, _ := c.Get("role")
	var role models.UserRole
	switch v := raw.(type) {
	case models.UserRole:
		role = v
	case string:
		role = models.UserRole(v)
	}
	return models.RoleHasPermission(role, perm)
}

// ─── Dashboard read ──────────────────────────────────────────────────────────

type screenshotOut struct {
	ID              uuid.UUID `json:"id"`
	CapturedAt      time.Time `json:"captured_at"`
	IntervalStart   time.Time `json:"interval_start"`
	IntervalEnd     time.Time `json:"interval_end"`
	ImageURL        string    `json:"image_url"`
	Width           int       `json:"width"`
	Height          int       `json:"height"`
	ActivityPercent int       `json:"activity_percent"`
	KeyboardCount   int       `json:"keyboard_count"`
	MouseCount      int       `json:"mouse_count"`
	ScrollCount     int       `json:"scroll_count"`
	State           string    `json:"state"`
}

type sessionOut struct {
	models.WorkSession
	Screenshots []screenshotOut `json:"screenshots"`
}

// timelineSegment is one coloured run on the activity bar.
type timelineSegment struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
	State string    `json:"state"` // active | idle
}

// Screenshots handles GET /monitoring/screenshots — the TeamLogger-style view:
// every session for one employee on one day, each with its screenshots, plus a
// derived activity timeline and day totals.
//
// The "day" is [date 00:00 + day_reset, +24h) in the requested timezone, so a
// 04:00 day-reset puts the small hours on the previous calendar day exactly as
// the reference UI does.
func (h *MonitoringHandler) Screenshots(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	employeeID, err := uuid.Parse(c.Query("employee_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "employee_id is required"})
		return
	}

	loc := time.UTC
	if tz := c.Query("tz"); tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	}
	dayReset := atoiOr(c.Query("day_reset"), 0) // hour, 0–23

	dateStr := c.Query("date")
	base, err := time.ParseInLocation("2006-01-02", dateStr, loc)
	if err != nil {
		base = time.Now().In(loc)
		base = time.Date(base.Year(), base.Month(), base.Day(), 0, 0, 0, 0, loc)
	}
	from := base.Add(time.Duration(dayReset) * time.Hour)
	to := from.Add(24 * time.Hour)

	var shots []models.Screenshot
	h.db.Where("org_id = ? AND employee_id = ? AND captured_at >= ? AND captured_at < ?",
		orgID, employeeID, from.UTC(), to.UTC()).
		Order("captured_at ASC").Find(&shots)

	// Group by session, minting a signed URL per image.
	bySession := map[uuid.UUID][]screenshotOut{}
	var orphans []screenshotOut
	for i := range shots {
		s := &shots[i]
		url, _ := h.store.SignedURL(s.StorageKey, 15*time.Minute)
		out := screenshotOut{
			ID: s.ID, CapturedAt: s.CapturedAt,
			IntervalStart: s.IntervalStart, IntervalEnd: s.IntervalEnd,
			ImageURL: url, Width: s.Width, Height: s.Height,
			ActivityPercent: s.ActivityPercent,
			KeyboardCount:   s.KeyboardCount, MouseCount: s.MouseCount, ScrollCount: s.ScrollCount,
			State: s.State,
		}
		if s.SessionID != nil {
			bySession[*s.SessionID] = append(bySession[*s.SessionID], out)
		} else {
			orphans = append(orphans, out)
		}
	}

	var sessions []models.WorkSession
	h.db.Where("org_id = ? AND employee_id = ? AND started_at < ? AND (ended_at IS NULL OR ended_at >= ?)",
		orgID, employeeID, to.UTC(), from.UTC()).
		Order("started_at ASC").Find(&sessions)

	out := make([]sessionOut, 0, len(sessions))
	for i := range sessions {
		out = append(out, sessionOut{WorkSession: sessions[i], Screenshots: bySession[sessions[i].ID]})
	}

	// Day totals + timeline from all of the day's screenshots.
	timeline := buildTimeline(shots, from, to)
	var activeSeconds, trackedSeconds int
	for i := range shots {
		activeSeconds += shots[i].ActiveSeconds
		trackedSeconds += shots[i].IntervalSeconds
	}
	avg := 0
	if trackedSeconds > 0 {
		avg = clampPercent(activeSeconds * 100 / trackedSeconds)
	}

	c.JSON(http.StatusOK, gin.H{
		"window":   gin.H{"from": from, "to": to, "day_reset": dayReset, "timezone": loc.String()},
		"sessions": out,
		"orphans":  orphans, // screenshots without a session (shouldn't normally happen)
		"timeline": timeline,
		"totals": gin.H{
			"screenshots":     len(shots),
			"active_seconds":  activeSeconds,
			"tracked_seconds": trackedSeconds,
			"avg_activity":    avg,
		},
		"permissions": gin.H{
			"delete_session":    hasPerm(c, models.PermMonitoringDeleteSes),
			"delete_screenshot": hasPerm(c, models.PermMonitoringDeleteImg),
		},
	})
}

// buildTimeline collapses per-screenshot intervals into contiguous coloured
// runs, so the bar shows a handful of segments rather than one per shot.
func buildTimeline(shots []models.Screenshot, from, to time.Time) []timelineSegment {
	segs := make([]timelineSegment, 0)
	for i := range shots {
		s := &shots[i]
		start, end := s.IntervalStart, s.IntervalEnd
		if !end.After(start) {
			continue
		}
		if len(segs) > 0 {
			last := &segs[len(segs)-1]
			// Merge when the same state runs on with no meaningful gap.
			if last.State == s.State && start.Sub(last.End) <= 90*time.Second {
				if end.After(last.End) {
					last.End = end
				}
				continue
			}
		}
		segs = append(segs, timelineSegment{Start: start, End: end, State: s.State})
	}
	return segs
}

// Employees handles GET /monitoring/employees — the picker for the screenshots
// view: everyone who has any monitoring data, so the dropdown isn't cluttered
// with people who were never captured.
func (h *MonitoringHandler) Employees(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var ids []uuid.UUID
	h.db.Model(&models.Screenshot{}).Distinct("employee_id").
		Where("org_id = ? AND employee_id IS NOT NULL", orgID).Pluck("employee_id", &ids)

	var employees []models.Employee
	if len(ids) > 0 {
		h.db.Where("id IN ?", ids).Order("first_name ASC").Find(&employees)
	}
	c.JSON(http.StatusOK, gin.H{"employees": employees})
}

// DeleteSession handles DELETE /monitoring/sessions/:id — removes the session
// and its screenshots (rows and objects).
func (h *MonitoringHandler) DeleteSession(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var session models.WorkSession
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	var shots []models.Screenshot
	h.db.Where("session_id = ?", session.ID).Find(&shots)
	for i := range shots {
		_ = h.deleteObject(shots[i].StorageKey)
	}
	h.db.Where("session_id = ?", session.ID).Delete(&models.Screenshot{})
	h.db.Delete(&session)

	c.JSON(http.StatusOK, gin.H{"message": "Session and its screenshots removed"})
}

// DeleteScreenshot handles DELETE /monitoring/screenshots/:id.
func (h *MonitoringHandler) DeleteScreenshot(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var shot models.Screenshot
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&shot).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Screenshot not found"})
		return
	}
	_ = h.deleteObject(shot.StorageKey)
	h.db.Delete(&shot)
	if shot.SessionID != nil {
		(&MonitoringIngestHandler{db: h.db, store: h.store}).refreshSessionRollup(*shot.SessionID)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Screenshot removed"})
}

// deleteObject best-effort removes the stored image. A storage miss must not
// block the row deletion — the row is the record of truth for the UI.
func (h *MonitoringHandler) deleteObject(key string) error {
	if d, ok := h.store.(interface{ Delete(string) error }); ok {
		return d.Delete(key)
	}
	return nil
}

// ─── Settings ────────────────────────────────────────────────────────────────

// GetSettings handles GET /monitoring/settings.
func (h *MonitoringHandler) GetSettings(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))
	s := screenshotSettingsFor(h.db, orgID)
	c.JSON(http.StatusOK, gin.H{"settings": s, "storage": h.store.Kind()})
}

// UpdateSettings handles PUT /monitoring/settings.
func (h *MonitoringHandler) UpdateSettings(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var in struct {
		Enabled              *bool `json:"enabled"`
		MinIntervalSeconds   *int  `json:"min_interval_seconds"`
		MaxIntervalSeconds   *int  `json:"max_interval_seconds"`
		IdleThresholdPercent *int  `json:"idle_threshold_percent"`
		Blur                 *bool `json:"blur"`
		RetentionDays        *int  `json:"retention_days"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	s := screenshotSettingsFor(h.db, orgID)
	if in.Enabled != nil {
		s.Enabled = *in.Enabled
	}
	if in.MinIntervalSeconds != nil {
		s.MinIntervalSeconds = *in.MinIntervalSeconds
	}
	if in.MaxIntervalSeconds != nil {
		s.MaxIntervalSeconds = *in.MaxIntervalSeconds
	}
	if in.IdleThresholdPercent != nil {
		s.IdleThresholdPercent = clampPercent(*in.IdleThresholdPercent)
	}
	if in.Blur != nil {
		s.Blur = *in.Blur
	}
	if in.RetentionDays != nil {
		s.RetentionDays = *in.RetentionDays
	}

	// Guard rails: a 0-second interval would hammer the agent, and min>max is
	// a foot-gun. Keep at least 20s and a sane ordering.
	if s.MinIntervalSeconds < 20 {
		s.MinIntervalSeconds = 20
	}
	if s.MaxIntervalSeconds < s.MinIntervalSeconds {
		s.MaxIntervalSeconds = s.MinIntervalSeconds
	}

	if err := h.db.Save(&s).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save settings"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"settings": s})
}

// StartScreenshotRetentionSweep deletes screenshots past each org's retention
// window — the settings screen promises "keep images for N days", so something
// has to enforce it or object storage grows without bound. Runs on a slow
// timer; a missed tick just means images linger a few more hours.
func StartScreenshotRetentionSweep(db *gorm.DB, interval time.Duration) {
	store := storage.New()
	go func() {
		ticker := time.NewTicker(interval)
		for range ticker.C {
			var settings []models.ScreenshotSettings
			db.Where("retention_days > 0").Find(&settings)
			for _, s := range settings {
				cutoff := time.Now().AddDate(0, 0, -s.RetentionDays)
				var old []models.Screenshot
				db.Where("org_id = ? AND captured_at < ?", s.OrgID, cutoff).
					Limit(2000).Find(&old)
				for i := range old {
					if d, ok := store.(interface{ Delete(string) error }); ok {
						_ = d.Delete(old[i].StorageKey)
					}
					db.Delete(&old[i])
				}
				// Drop sessions that ended before the cutoff and have no images left.
				db.Where("org_id = ? AND ended_at IS NOT NULL AND ended_at < ? AND screenshot_count = 0",
					s.OrgID, cutoff).Delete(&models.WorkSession{})
			}
		}
	}()
}

// ─── Public media route (local backend only) ─────────────────────────────────

// ServeMedia handles GET /media/screenshot?key=&exp=&sig= — a public,
// HMAC-signed route so an <img> can load a locally-stored screenshot without
// an Authorization header. R2 never uses this; its signed URLs point straight
// at the bucket.
func ServeMedia(c *gin.Context) {
	key := c.Query("key")
	sig := c.Query("sig")
	exp, _ := strconv.ParseInt(c.Query("exp"), 10, 64)
	if key == "" || sig == "" || !storage.VerifyLocalToken(key, sig, exp) {
		c.String(http.StatusForbidden, "invalid or expired link")
		return
	}
	store := storage.New()
	rc, contentType, err := store.Open(c.Request.Context(), key)
	if err != nil {
		c.String(http.StatusNotFound, "not found")
		return
	}
	defer rc.Close()
	c.Header("Cache-Control", "private, max-age=900")
	c.Header("Content-Type", contentType)
	_, _ = io.Copy(c.Writer, rc)
}
