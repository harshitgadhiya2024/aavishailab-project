package handlers

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/dataplane"
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
	if limit < 1 { limit = 50 }

	st, ok := eventStore(c, orgID)
	if !ok {
		return
	}

	q := dataplane.EventQuery{OrgID: orgUUID(c)}
	teamEmployeeScope(h.db, c, &q)

	// "Allowed" is never shown, anywhere, regardless of what the caller asks
	// for — hard exclusion rather than something a filter value could opt
	// back into. Both agents now stop sending it and every write path drops
	// it (see dropAllowedEvents), so this is mainly for the rows already in
	// the database from before that fix; an explicit ?action=allowed simply
	// gets an empty result instead of a page of routine traffic.
	q.NotActions = []string{string(models.EventActionAllowed)}

	if id, err := uuid.Parse(empID); err == nil {
		q.EmployeeID = &id
	} else if empID != "" {
		q.IDs = []uuid.UUID{uuid.Nil} // a malformed id matches nothing, never everything
	}
	if eventType != "" {
		q.EventTypes = []string{eventType}
	}
	// source groups events the way the dashboard's tabs do — "which part of the
	// product produced this". It is derived from (event_type, category) rather
	// than stored, because every writer already sets those two consistently and
	// a third denormalised column would only be one more thing to keep in sync.
	q.AnyOf = activitySourceScope(c.Query("source"))
	// action accepts a comma-separated list ("blocked,alerted") so a caller can
	// ask for several outcomes at once without dropping to no filter at all —
	// which would pull in the allowed/logged telemetry that isn't an incident.
	if action != "" {
		q.Actions = splitCSV(action)
	}
	if search != "" {
		q.Search = search
		q.SearchFields = []string{"target", "target_domain", "process_name"}
	}

	// Time range
	if days > 0 {
		q.Since = time.Now().AddDate(0, 0, -days)
	}
	if startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			q.Since = t
		}
	}
	if endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			q.Until = t
		}
	}

	ctx := c.Request.Context()
	total, err := st.CountEvents(ctx, q)
	if err != nil {
		respondStoreError(c, err)
		return
	}
	q.Offset, q.Limit = (page-1)*limit, limit
	events, err := st.FindEvents(ctx, q)
	if err != nil {
		respondStoreError(c, err)
		return
	}

	// Attach employee names manually rather than Preload("Employee"): Employee
	// also has its own (unrelated, HRIS) EmployeeID field, which collides with
	// GORM's foreign-key auto-detection for this association and makes it
	// silently query the wrong column.
	attachEmployees(h.db, events)
	attachTargetApps(c.Request.Context(), orgID, events)
	fillOperations(events)

	c.JSON(http.StatusOK, gin.H{
		"data":  events,
		"total": total,
		"page":  page,
		"limit": limit,
		"pages": (total + int64(limit) - 1) / int64(limit),
	})
}

// activitySourceScope maps a source name to the event filter for that
// dashboard tab, or nil for "no filter" (unknown name or empty). Deliberately
// nil rather than an error: an unrecognised source showing everything is a
// far better failure than a tab that renders empty and looks like a data loss.
//
// The categories below are exactly what the writers set — agents.go writes
// "dlp", "malware_detection" and "device_posture"; appcontrol.go writes
// "application_control"; the proxy's web telemetry writes "", "domain",
// "url_category" or "threat_intelligence".
func activitySourceScope(source string) []dataplane.EventClause {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "web_gateway", "swg":
		// Malware is excluded on purpose: a blocked download is download
		// protection's event, not the web gateway's, and it has its own tab.
		return []dataplane.EventClause{{
			EventTypes:    dataplane.Strings(models.EventTypeWebRequest, models.EventTypeDNSQuery),
			NotCategories: []string{"dlp", "malware", "malware_detection", "device_posture", "application_control"},
		}}
	case "dlp":
		return []dataplane.EventClause{{Categories: []string{"dlp"}}}
	case "malware", "download":
		return []dataplane.EventClause{{Categories: []string{"malware", "malware_detection"}}}
	case "application", "app_control":
		return []dataplane.EventClause{
			{EventTypes: dataplane.Strings(models.EventTypeProcessStart, models.EventTypeAppLaunch, models.EventTypeAppInstall)},
			{Categories: []string{"application_control"}},
		}
	case "device_posture", "posture":
		return []dataplane.EventClause{{Categories: []string{"device_posture"}}}
	case "device":
		return []dataplane.EventClause{{EventTypes: dataplane.Strings(
			models.EventTypeDeviceConnect,
			models.EventTypeDeviceDisconnect,
			models.EventTypeDeviceUninstall,
		)}}
	default:
		return nil
	}
}

// dropAllowedEvents strips "allowed" rows before anything is persisted.
//
// "Allowed" is routine, ordinary traffic — every one of the hundreds of
// ordinary requests a workday produces. It is never shown anywhere on the
// dashboard (see activitySourceScope and the hard exclusion in List below),
// and before this it was still written to disk on every single request: on
// a real org, 3,978 of 4,787 stored rows (83%) were exactly this. Both
// agents now stop sending it at the source, but this is where every write
// path funnels through, so it is enforced here too regardless of what any
// agent version — past, present, or a slow-to-update one — sends.
//
// Order-preserving, and safe to call on an empty or nil slice.
func dropAllowedEvents(events []models.ActivityEvent) []models.ActivityEvent {
	out := events[:0]
	for _, ev := range events {
		if ev.Action == models.EventActionAllowed {
			continue
		}
		out = append(out, ev)
	}
	return out
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
	st, ok := eventStore(c, orgID)
	if !ok {
		return
	}
	ctx := c.Request.Context()

	// Optional event_type narrows every figure below. Without it the response is
	// exactly what it always was; with it a caller like the DLP page gets counts
	// for policy violations alone instead of web-request blocks mixed in.
	eventType := c.Query("event_type")
	// Same hard exclusion the List handler applies: these counters sit at the
	// top of the very page whose table can never contain an allowed row, so a
	// "total events" that counted them would not match the rows underneath it.
	scope := dataplane.EventQuery{
		OrgID:      orgUUID(c),
		Since:      since,
		NotActions: []string{string(models.EventActionAllowed)},
	}
	if eventType != "" {
		scope.EventTypes = []string{eventType}
	}

	type StatsResult struct {
		TotalEvents   int64   `json:"total_events"`
		BlockedEvents int64   `json:"blocked_events"`
		AlertedEvents int64   `json:"alerted_events"`
		UniqueUsers   int64   `json:"unique_users"`
		AvgRiskScore  float64 `json:"avg_risk_score"`
	}
	var stats StatsResult
	totals, err := st.GroupEvents(ctx, scope, "", 0)
	if err != nil {
		respondStoreError(c, err)
		return
	}
	if len(totals) > 0 && totals[0].Count > 0 {
		stats.TotalEvents = totals[0].Count
		stats.UniqueUsers = totals[0].Employees
		stats.AvgRiskScore = totals[0].RiskSum / float64(totals[0].Count)
	}
	byAction, _ := st.GroupEvents(ctx, scope, "action", 0)
	for _, g := range byAction {
		switch g.Key {
		case string(models.EventActionBlocked):
			stats.BlockedEvents = g.Count
		case string(models.EventActionAlerted):
			stats.AlertedEvents = g.Count
		}
	}

	// Top blocked domains
	type DomainCount struct {
		Domain string `json:"domain"`
		Count  int    `json:"count"`
	}
	topDomains := []DomainCount{}
	blocked := scope
	blocked.Actions = []string{string(models.EventActionBlocked)}
	blocked.HasTargetDomain = true
	if groups, err := st.GroupEvents(ctx, blocked, "target_domain", 10); err == nil {
		for _, g := range groups {
			topDomains = append(topDomains, DomainCount{g.Key, int(g.Count)})
		}
	}

	// Event type breakdown. Filtered too, for consistency with every other
	// figure — asking for one event_type collapses this to that single row
	// rather than reporting a breakdown at a different scope than the counts
	// above it.
	type TypeCount struct {
		EventType string `json:"event_type"`
		Count     int    `json:"count"`
	}
	byType := []TypeCount{}
	if groups, err := st.GroupEvents(ctx, scope, "event_type", 0); err == nil {
		for _, g := range groups {
			byType = append(byType, TypeCount{g.Key, int(g.Count)})
		}
	}

	// Days and per-employee counts in one pass over the period, without
	// metadata; detectors in a second pass over DLP findings only — the only
	// events whose metadata carries them.
	type DayCount struct {
		Date    string `json:"date"`
		Total   int    `json:"total"`
		Blocked int    `json:"blocked"`
	}
	dayCounts := map[string]*DayCount{}
	perEmployee := map[uuid.UUID]int{}
	pass := scope
	pass.Fields = []string{"employee_id", "action", "timestamp"}
	pass.Ascending = true
	err = st.EachEvent(ctx, pass, func(ev *models.ActivityEvent) error {
		day := ev.Timestamp.UTC().Format("2006-01-02")
		dc := dayCounts[day]
		if dc == nil {
			dc = &DayCount{Date: day}
			dayCounts[day] = dc
		}
		dc.Total++
		if ev.Action == models.EventActionBlocked {
			dc.Blocked++
		}
		if ev.EmployeeID != nil {
			perEmployee[*ev.EmployeeID]++
		}
		return nil
	})
	if err != nil {
		respondStoreError(c, err)
		return
	}
	detectors := map[string]int{}
	dlp := scope
	dlp.Categories = []string{"dlp"}
	dlp.Fields = []string{"metadata", "timestamp"}
	err = st.EachEvent(ctx, dlp, func(ev *models.ActivityEvent) error {
		if list, ok := ev.Metadata["detectors"].([]any); ok {
			for _, d := range list {
				if s, ok := d.(string); ok && s != "" {
					detectors[s]++
				}
			}
		}
		return nil
	})
	if err != nil {
		respondStoreError(c, err)
		return
	}

	// Most frequently triggered DLP detector.
	type DetectorCount struct {
		Detector string `json:"detector"`
		Count    int    `json:"count"`
	}
	topDetectors := []DetectorCount{}
	for _, lc := range sortedLabels(detectors) {
		if len(topDetectors) == 5 {
			break
		}
		topDetectors = append(topDetectors, DetectorCount{lc.Label, lc.Count})
	}

	byDay := make([]DayCount, 0, len(dayCounts))
	for _, d := range dayCounts {
		byDay = append(byDay, *d)
	}
	sort.Slice(byDay, func(i, j int) bool { return byDay[i].Date < byDay[j].Date })

	// Top users by risk. Employees with no events in the period still appear
	// with a zero count — the employee's own risk score leads the ranking.
	type UserRisk struct {
		EmployeeID uuid.UUID `json:"employee_id"`
		Name       string    `json:"name"`
		RiskScore  float64   `json:"risk_score"`
		Events     int       `json:"events"`
	}
	var emps []models.Employee
	h.db.Select("id", "first_name", "last_name", "risk_score").Where("org_id = ?", orgID).Find(&emps)
	topUsers := make([]UserRisk, 0, len(emps))
	for _, e := range emps {
		topUsers = append(topUsers, UserRisk{
			EmployeeID: e.ID, Name: e.FirstName + " " + e.LastName,
			RiskScore: e.RiskScore, Events: perEmployee[e.ID],
		})
	}
	sort.SliceStable(topUsers, func(i, j int) bool {
		if topUsers[i].RiskScore != topUsers[j].RiskScore {
			return topUsers[i].RiskScore > topUsers[j].RiskScore
		}
		return topUsers[i].Events > topUsers[j].Events
	})
	if len(topUsers) > 5 {
		topUsers = topUsers[:5]
	}

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

	// "Allowed" is never stored — see dropAllowedEvents.
	if event.Action == models.EventActionAllowed {
		c.JSON(http.StatusCreated, gin.H{"id": nil})
		return
	}

	// Always the caller's own organization, whatever the body says.
	event.OrgID = orgUUID(c)
	event.ID = uuid.Nil
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}
	if event.Operation == "" {
		event.Operation = operationForEventType(event.EventType)
	}

	if err := recordAndBroadcast(c.Request.Context(), h.db, h.hub, &event); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record event"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": event.ID})
}

// BulkCreate handles POST /activity/bulk (batch from agent)
func (h *ActivityHandler) BulkCreate(c *gin.Context) {
	var events []models.ActivityEvent
	if err := c.ShouldBindJSON(&events); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// "Allowed" is never stored — see dropAllowedEvents.
	events = dropAllowedEvents(events)
	if len(events) == 0 {
		c.JSON(http.StatusCreated, gin.H{"created": 0})
		return
	}

	org := orgUUID(c)
	for i := range events {
		events[i].OrgID = org
		events[i].ID = uuid.Nil
		if events[i].Timestamp.IsZero() {
			events[i].Timestamp = time.Now()
		}
		if events[i].Operation == "" {
			events[i].Operation = operationForEventType(events[i].EventType)
		}
	}

	// Blocked pages fold per host (see dataplane.RecordDeduped): a browser
	// retries a blocked page, and http→https redirects hit the block twice.
	// Everything else in the batch is inserted as-is.
	ctx := c.Request.Context()
	var plain, stored []models.ActivityEvent
	for i := range events {
		key := ""
		if events[i].EventType == models.EventTypeWebRequest {
			key = webDedupeKey(&events[i])
		}
		if key == "" {
			plain = append(plain, events[i])
			continue
		}
		_, dup, err := dataplane.RecordDeduped(ctx, org, &events[i], key, webBlockDedupeWindow, nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to batch insert events"})
			return
		}
		if !dup {
			stored = append(stored, events[i])
		}
	}
	if len(plain) > 0 {
		if err := dataplane.RecordEvents(ctx, org, eventPtrs(plain)...); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to batch insert events"})
			return
		}
	}
	events = append(stored, plain...)

	// Look up each distinct employee once so live broadcasts can show a name,
	// not just an ID, in the company dashboard.
	broadcastEvents(h.db, h.hub, events)

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
func attachTargetApps(ctx context.Context, orgID string, events []models.ActivityEvent) {
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

	results, err := shadowitclient.Classify(ctx, orgID, domains)
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
