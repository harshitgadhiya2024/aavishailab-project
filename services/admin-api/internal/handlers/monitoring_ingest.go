package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/storage"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// MonitoringIngestHandler receives sessions, screenshots and activity from the
// agent. It shares the agent auth (device_id:agent_key) with the other
// /internal/agent routes.
type MonitoringIngestHandler struct {
	db      *gorm.DB
	store   storage.Backend
	agentH  *AgentHandler
	maxSize int64
}

func NewMonitoringIngestHandler(db *gorm.DB, agentH *AgentHandler) *MonitoringIngestHandler {
	return &MonitoringIngestHandler{
		db:      db,
		store:   storage.New(),
		agentH:  agentH,
		maxSize: 8 * 1024 * 1024, // a full-screen webp is well under this
	}
}

// screenshotSettingsFor returns an org's settings, creating defaults on first
// use so the agent always has something to read.
func screenshotSettingsFor(db *gorm.DB, orgID uuid.UUID) models.ScreenshotSettings {
	var s models.ScreenshotSettings
	if err := db.Where("org_id = ?", orgID).First(&s).Error; err == gorm.ErrRecordNotFound {
		s = models.DefaultScreenshotSettings(orgID)
		db.Create(&s)
	}
	return s
}

// StartSession handles POST /internal/agent/session/start.
func (h *MonitoringIngestHandler) StartSession(c *gin.Context) {
	deviceID, orgID, empID := h.agentH.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	var in struct {
		Hostname  string `json:"hostname"`
		IP        string `json:"ip"`
		StartedAt string `json:"started_at"`
	}
	_ = c.ShouldBindJSON(&in)

	started := time.Now()
	if in.StartedAt != "" {
		if t, err := time.Parse(time.RFC3339, in.StartedAt); err == nil {
			started = t
		}
	}
	ip := in.IP
	if ip == "" {
		ip = c.ClientIP()
	}

	session := models.WorkSession{
		OrgID:      orgID,
		EmployeeID: empID,
		DeviceID:   &deviceID,
		StartedAt:  started,
		Hostname:   in.Hostname,
		IP:         ip,
		Project:    "Default Project",
		Task:       "Default Task",
	}
	if err := h.db.Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open session"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"session_id": session.ID})
}

// EndSession handles POST /internal/agent/session/end.
func (h *MonitoringIngestHandler) EndSession(c *gin.Context) {
	deviceID, orgID, _ := h.agentH.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	var in struct {
		SessionID string `json:"session_id" binding:"required"`
		EndedAt   string `json:"ended_at"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ended := time.Now()
	if in.EndedAt != "" {
		if t, err := time.Parse(time.RFC3339, in.EndedAt); err == nil {
			ended = t
		}
	}
	h.db.Model(&models.WorkSession{}).
		Where("id = ? AND org_id = ? AND ended_at IS NULL", in.SessionID, orgID).
		Update("ended_at", ended)
	c.JSON(http.StatusOK, gin.H{"ended": true})
}

// UploadScreenshot handles POST /internal/agent/screenshot. The image is the
// raw request body; everything else rides in query params so the body stays
// exactly the bytes to store (the same convention the scan endpoints use).
func (h *MonitoringIngestHandler) UploadScreenshot(c *gin.Context) {
	deviceID, orgID, empID := h.agentH.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	// Respect the org toggle even if an agent somehow uploads while disabled —
	// don't store screens the company turned off.
	if !screenshotSettingsFor(h.db, orgID).Enabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "Screenshot capture is disabled for this organization"})
		return
	}

	data, err := readLimited(c.Request.Body, h.maxSize)
	if err != nil {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Image too large"})
		return
	}
	if len(data) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Empty image"})
		return
	}

	q := c.Request.URL.Query()
	capturedAt := parseTimeOr(q.Get("captured_at"), time.Now())
	intervalStart := parseTimeOr(q.Get("interval_start"), capturedAt)
	intervalEnd := parseTimeOr(q.Get("interval_end"), capturedAt)

	var sessionID *uuid.UUID
	if sid, err := uuid.Parse(q.Get("session_id")); err == nil {
		sessionID = &sid
	}

	intervalSeconds := atoiOr(q.Get("interval_seconds"), int(intervalEnd.Sub(intervalStart).Seconds()))
	activeSeconds := atoiOr(q.Get("active_seconds"), 0)
	percent := atoiOr(q.Get("activity_percent"), 0)
	if percent == 0 && intervalSeconds > 0 {
		percent = clampPercent(activeSeconds * 100 / intervalSeconds)
	}

	settings := screenshotSettingsFor(h.db, orgID)
	state := "active"
	if percent < settings.IdleThresholdPercent {
		state = "idle"
	}

	// Key layout groups by org/employee/day so retention and per-person
	// listing are cheap prefix scans.
	key := screenshotKey(orgID, empID, capturedAt)
	contentType := q.Get("content_type")
	if contentType == "" {
		contentType = "image/webp"
	}
	if err := h.store.Put(context.Background(), key, contentType, data); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to store the image"})
		return
	}

	shot := models.Screenshot{
		OrgID:           orgID,
		EmployeeID:      empID,
		DeviceID:        &deviceID,
		SessionID:       sessionID,
		CapturedAt:      capturedAt,
		IntervalStart:   intervalStart,
		IntervalEnd:     intervalEnd,
		StorageKey:      key,
		Width:           atoiOr(q.Get("width"), 0),
		Height:          atoiOr(q.Get("height"), 0),
		Bytes:           len(data),
		ActivityPercent: percent,
		ActiveSeconds:   activeSeconds,
		IntervalSeconds: intervalSeconds,
		KeyboardCount:   atoiOr(q.Get("keyboard"), 0),
		MouseCount:      atoiOr(q.Get("mouse"), 0),
		ScrollCount:     atoiOr(q.Get("scroll"), 0),
		State:           state,
	}
	if err := h.db.Create(&shot).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record the screenshot"})
		return
	}

	if sessionID != nil {
		h.refreshSessionRollup(*sessionID)
	}

	c.JSON(http.StatusOK, gin.H{"screenshot_id": shot.ID, "activity_percent": percent})
}

// refreshSessionRollup recomputes the session's totals from its screenshots so
// list views never have to aggregate on read.
func (h *MonitoringIngestHandler) refreshSessionRollup(sessionID uuid.UUID) {
	var agg struct {
		Count   int
		Active  int
		Tracked int
		Avg     float64
	}
	h.db.Model(&models.Screenshot{}).
		Select("COUNT(*) as count, COALESCE(SUM(active_seconds),0) as active, "+
			"COALESCE(SUM(interval_seconds),0) as tracked, COALESCE(AVG(activity_percent),0) as avg").
		Where("session_id = ?", sessionID).Scan(&agg)

	h.db.Model(&models.WorkSession{}).Where("id = ?", sessionID).Updates(map[string]any{
		"screenshot_count": agg.Count,
		"active_seconds":   agg.Active,
		"tracked_seconds":  agg.Tracked,
		"avg_activity":     agg.Avg,
	})
}

func screenshotKey(orgID uuid.UUID, empID *uuid.UUID, at time.Time) string {
	emp := "unassigned"
	if empID != nil {
		emp = empID.String()
	}
	return "screenshots/" + orgID.String() + "/" + emp + "/" +
		at.UTC().Format("2006/01/02") + "/" + uuid.NewString() + ".webp"
}
