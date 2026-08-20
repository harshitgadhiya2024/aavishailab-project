package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/shadowitclient"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ActivityHandler struct {
	db  *gorm.DB
	hub *WebSocketHub
}

func NewActivityHandler(db *gorm.DB, hub *WebSocketHub) *ActivityHandler {
	return &ActivityHandler{db: db, hub: hub}
}

// List handles GET /activity
func (h *ActivityHandler) List(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	page, _    := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _   := strconv.Atoi(c.DefaultQuery("limit", "50"))
	empID      := c.Query("employee_id")
	eventType  := c.Query("event_type")
	action     := c.Query("action")
	startStr   := c.Query("start")
	endStr     := c.Query("end")
	search     := c.Query("search")
	days, _    := strconv.Atoi(c.Query("days"))

	if page < 1 { page = 1 }
	if limit > 200 { limit = 200 }

	q := h.db.Where("org_id = ?", orgID)
	q = applyEmployeeTeamScope(h.db, c, q, "employee_id")

	if empID != "" {
		q = q.Where("employee_id = ?", empID)
	}
	if eventType != "" {
		q = q.Where("event_type = ?", eventType)
	}
	// action accepts a comma-separated list ("blocked,alerted") so a caller can
	// ask for several outcomes at once without dropping to no filter at all —
	// which would pull in the allowed/logged telemetry that isn't an incident.
	if action != "" {
		if actions := splitCSV(action); len(actions) > 1 {
			q = q.Where("action IN ?", actions)
		} else {
			q = q.Where("action = ?", action)
		}
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("target LIKE ? OR target_domain LIKE ? OR process_name LIKE ?", like, like, like)
	}

	// Time range
	if days > 0 {
		q = q.Where("timestamp >= ?", time.Now().AddDate(0, 0, -days))
	}
	if startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			q = q.Where("timestamp >= ?", t)
		}
	}
	if endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			q = q.Where("timestamp <= ?", t)
		}
	}

	// Each terminal call gets its own session — reusing the same *gorm.DB
	// across Count() and then Find() causes the second call to misbehave
	// (a well-known GORM footgun).
	var total int64
	q.Session(&gorm.Session{}).Model(&models.ActivityEvent{}).Count(&total)

	var events []models.ActivityEvent
	q.Session(&gorm.Session{}).
		Order("timestamp DESC").
		Offset((page-1)*limit).Limit(limit).
		Find(&events)

	// Attach employee names manually rather than Preload("Employee"): Employee
	// also has its own (unrelated, HRIS) EmployeeID field, which collides with
	// GORM's foreign-key auto-detection for this association and makes it
	// silently query the wrong column.
	attachEmployees(h.db, events)
	attachTargetApps(orgID, events)
	fillOperations(events)

	c.JSON(http.StatusOK, gin.H{
		"data":  events,
		"total": total,
		"page":  page,
		"limit": limit,
		"pages": (total + int64(limit) - 1) / int64(limit),
	})
}

// splitCSV turns "blocked, alerted" into ["blocked", "alerted"], dropping
// blanks so a trailing comma doesn't produce an empty filter value.
func splitCSV(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if v := strings.TrimSpace(part); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// Stats handles GET /activity/stats
func (h *ActivityHandler) Stats(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	since := time.Now().AddDate(0, 0, -days)

	// Optional event_type narrows every figure below. Without it the response is
	// exactly what it always was; with it a caller like the DLP page gets counts
	// for policy violations alone instead of web-request blocks mixed in.
	eventType := c.Query("event_type")
	typeSQL := ""
	var typeArgs []any
	if eventType != "" {
		typeSQL = " AND event_type = ?"
		typeArgs = append(typeArgs, eventType)
	}
	scoped := func() *gorm.DB {
		q := h.db.Model(&models.ActivityEvent{}).Where("org_id = ? AND timestamp >= ?", orgID, since)
		if eventType != "" {
			q = q.Where("event_type = ?", eventType)
		}
		return q
	}

	type StatsResult struct {
		TotalEvents   int64   `json:"total_events"`
		BlockedEvents int64   `json:"blocked_events"`
		AlertedEvents int64   `json:"alerted_events"`
		UniqueUsers   int64   `json:"unique_users"`
		AvgRiskScore  float64 `json:"avg_risk_score"`
	}

	var stats StatsResult
	scoped().Count(&stats.TotalEvents)
	scoped().Where("action = ?", "blocked").Count(&stats.BlockedEvents)
	scoped().Where("action = ?", "alerted").Count(&stats.AlertedEvents)
	scoped().Distinct("employee_id").Count(&stats.UniqueUsers)
	scoped().Select("COALESCE(AVG(risk_score), 0)").Scan(&stats.AvgRiskScore)

	// Top blocked domains
	type DomainCount struct {
		Domain string `json:"domain"`
		Count  int    `json:"count"`
	}
	var topDomains []DomainCount
	h.db.Raw(`SELECT target_domain as domain, COUNT(*) as count
		FROM activity_events
		WHERE org_id = ? AND timestamp >= ? AND action = 'blocked' AND target_domain != ''`+typeSQL+`
		GROUP BY target_domain ORDER BY count DESC LIMIT 10`,
		append([]any{orgID, since}, typeArgs...)...).
		Scan(&topDomains)

	// Most frequently triggered DLP detector. metadata->'detectors' is only an
	// array on scan events, so non-array rows are filtered out before the
	// element expansion — jsonb_array_elements_text errors on anything else.
	type DetectorCount struct {
		Detector string `json:"detector"`
		Count    int    `json:"count"`
	}
	var topDetectors []DetectorCount
	h.db.Raw(`SELECT d as detector, COUNT(*) as count
		FROM activity_events, LATERAL jsonb_array_elements_text(metadata->'detectors') as d
		WHERE org_id = ? AND timestamp >= ? AND jsonb_typeof(metadata->'detectors') = 'array'`+typeSQL+`
		GROUP BY d ORDER BY count DESC LIMIT 5`,
		append([]any{orgID, since}, typeArgs...)...).
		Scan(&topDetectors)

	// Top users by risk
	type UserRisk struct {
		EmployeeID uuid.UUID `json:"employee_id"`
		Name       string    `json:"name"`
		RiskScore  float64   `json:"risk_score"`
		Events     int       `json:"events"`
	}
	var topUsers []UserRisk
	// The event_type filter belongs in the JOIN condition, not WHERE: this is a
	// LEFT JOIN, and filtering in WHERE would drop employees with no matching
	// events instead of showing them with a zero count.
	h.db.Raw(`SELECT e.id as employee_id,
		e.first_name || ' ' || e.last_name as name,
		e.risk_score,
		COUNT(ae.id) as events
		FROM employees e
		LEFT JOIN activity_events ae ON ae.employee_id = e.id AND ae.timestamp >= ?`+
		strings.ReplaceAll(typeSQL, "event_type", "ae.event_type")+`
		WHERE e.org_id = ?
		GROUP BY e.id, e.first_name, e.last_name, e.risk_score
		ORDER BY risk_score DESC, events DESC
		LIMIT 5`, append(append([]any{since}, typeArgs...), orgID)...).Scan(&topUsers)

	// Events by day
	type DayCount struct {
		Date    string `json:"date"`
		Total   int    `json:"total"`
		Blocked int    `json:"blocked"`
	}
	var byDay []DayCount
	h.db.Raw(`SELECT DATE(timestamp) as date,
		COUNT(*) as total,
		COUNT(*) FILTER (WHERE action = 'blocked') as blocked
		FROM activity_events
		WHERE org_id = ? AND timestamp >= ?`+typeSQL+`
		GROUP BY DATE(timestamp)
		ORDER BY date ASC`, append([]any{orgID, since}, typeArgs...)...).Scan(&byDay)

	// Event type breakdown
	type TypeCount struct {
		EventType string `json:"event_type"`
		Count     int    `json:"count"`
	}
	// Filtered too, for consistency with every other figure — asking for one
	// event_type collapses this to that single row rather than reporting a
	// breakdown at a different scope than the counts above it.
	var byType []TypeCount
	h.db.Raw(`SELECT event_type, COUNT(*) as count
		FROM activity_events
		WHERE org_id = ? AND timestamp >= ?`+typeSQL+`
		GROUP BY event_type ORDER BY count DESC`,
		append([]any{orgID, since}, typeArgs...)...).Scan(&byType)

	c.JSON(http.StatusOK, gin.H{
		"stats":         stats,
		"top_domains":   topDomains,
		"top_detectors": topDetectors,
		"top_users":     topUsers,
		"by_day":        byDay,
		"by_type":       byType,
		"period_days":   days,
		"event_type":    eventType,
	})
}

// Create handles POST /activity (from authenticated dashboard)
func (h *ActivityHandler) Create(c *gin.Context) {
	h.createEvent(c)
}

func (h *ActivityHandler) createEvent(c *gin.Context) {
	var event models.ActivityEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}
	if event.Operation == "" {
		event.Operation = operationForEventType(event.EventType)
	}

	if err := h.db.Create(&event).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record event"})
		return
	}

	events := []models.ActivityEvent{event}
	attachEmployees(h.db, events)
	event = events[0]
	h.hub.BroadcastActivityEvent(event)
	c.JSON(http.StatusCreated, gin.H{"id": event.ID})
}

// BulkCreate handles POST /activity/bulk (batch from agent)
func (h *ActivityHandler) BulkCreate(c *gin.Context) {
	var events []models.ActivityEvent
	if err := c.ShouldBindJSON(&events); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for i := range events {
		if events[i].Timestamp.IsZero() {
			events[i].Timestamp = time.Now()
		}
		if events[i].Operation == "" {
			events[i].Operation = operationForEventType(events[i].EventType)
		}
	}

	if err := h.db.CreateInBatches(&events, 100).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to batch insert events"})
		return
	}

	// Look up each distinct employee once so live broadcasts can show a name,
	// not just an ID, in the company dashboard.
	attachEmployees(h.db, events)

	for _, ev := range events {
		h.hub.BroadcastActivityEvent(ev)
	}

	c.JSON(http.StatusCreated, gin.H{"created": len(events)})
}

// attachEmployees batch-fetches each distinct employee referenced by events
// and sets ev.Employee on each one. Used instead of Preload("Employee"):
// Employee has its own (unrelated, HRIS) EmployeeID field, which collides
// with GORM's foreign-key auto-detection for this association and makes it
// silently query the wrong column.
func attachEmployees(db *gorm.DB, events []models.ActivityEvent) {
	empIDs := make(map[uuid.UUID]bool)
	for _, ev := range events {
		if ev.EmployeeID != nil {
			empIDs[*ev.EmployeeID] = true
		}
	}
	if len(empIDs) == 0 {
		return
	}

	ids := make([]uuid.UUID, 0, len(empIDs))
	for id := range empIDs {
		ids = append(ids, id)
	}
	var emps []models.Employee
	db.Where("id IN ?", ids).Find(&emps)

	empByID := make(map[uuid.UUID]models.Employee, len(emps))
	for _, e := range emps {
		empByID[e.ID] = e
	}

	for i := range events {
		if events[i].EmployeeID == nil {
			continue
		}
		if emp, ok := empByID[*events[i].EmployeeID]; ok {
			e := emp
			events[i].Employee = &e
		}
	}
}

// attachTargetApps resolves each distinct target_domain to a human-readable
// platform name via shadowit-service, so an incident reads "Microsoft 365"
// rather than editor.svc.cloud.microsoft. One batched call per page.
//
// Fails open: if shadowit-service is unset or unreachable the events keep their
// raw domain and target_app stays empty, which the UI falls back to.
func attachTargetApps(orgID string, events []models.ActivityEvent) {
	if !shadowitclient.Enabled() || len(events) == 0 {
		return
	}

	seen := make(map[string]bool)
	domains := make([]string, 0, len(events))
	for _, ev := range events {
		d := normDomain(ev.TargetDomain)
		if d == "" || seen[d] {
			continue
		}
		seen[d] = true
		domains = append(domains, d)
	}
	if len(domains) == 0 {
		return
	}

	results, err := shadowitclient.Classify(orgID, domains)
	if err != nil {
		return
	}

	nameByDomain := make(map[string]string, len(results))
	for _, r := range results {
		if r.DisplayName != "" {
			nameByDomain[normDomain(r.Domain)] = r.DisplayName
		}
	}
	for i := range events {
		if name, ok := nameByDomain[normDomain(events[i].TargetDomain)]; ok {
			events[i].TargetApp = name
		}
	}
}

// normDomain mirrors the shadow-IT catalog's normalisation so lookups key
// consistently on either side of the call.
func normDomain(d string) string {
	d = strings.ToLower(strings.TrimSpace(d))
	d = strings.TrimSuffix(d, ".")
	return strings.TrimPrefix(d, "www.")
}
