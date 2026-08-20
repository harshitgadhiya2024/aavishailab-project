package handlers

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ReportHandler backs the dashboard's analytics and the Reports section.
//
// Everything here answers over a caller-chosen window and, where it's
// meaningful, against the window immediately before it — a count on its own
// ("312 blocked") tells an admin far less than its direction ("312, up 48%
// from the previous 30 days").
type ReportHandler struct {
	db *gorm.DB
}

func NewReportHandler(db *gorm.DB) *ReportHandler { return &ReportHandler{db: db} }

// reportWindow resolves ?days= (or explicit ?start=/?end=) into the current
// window plus the preceding one of equal length, for period-over-period deltas.
type reportWindow struct {
	Days      int
	Start     time.Time
	End       time.Time
	PrevStart time.Time
	PrevEnd   time.Time
}

func parseWindow(c *gin.Context) reportWindow {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days <= 0 || days > 365 {
		days = 30
	}
	end := time.Now()
	if v := c.Query("end"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			end = t
		}
	}
	start := end.AddDate(0, 0, -days)
	if v := c.Query("start"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			start = t
			days = int(end.Sub(start).Hours()/24) + 1
		}
	}
	span := end.Sub(start)
	return reportWindow{
		Days:      days,
		Start:     start,
		End:       end,
		PrevStart: start.Add(-span),
		PrevEnd:   start,
	}
}

// delta reports percent change, using nil for "no baseline" rather than a
// fabricated 0% or a divide-by-zero 100% — a first-ever week has no trend.
func delta(current, previous int64) *float64 {
	if previous == 0 {
		return nil
	}
	d := (float64(current) - float64(previous)) / float64(previous) * 100
	rounded := float64(int(d*10)) / 10
	return &rounded
}

func (h *ReportHandler) countEvents(orgID string, from, to time.Time, where string, args ...any) int64 {
	var n int64
	q := h.db.Model(&models.ActivityEvent{}).
		Where("org_id = ? AND timestamp >= ? AND timestamp < ?", orgID, from, to)
	if where != "" {
		q = q.Where(where, args...)
	}
	q.Count(&n)
	return n
}

// ─── Overview (dashboard) ─────────────────────────────────────────────────────

// Overview handles GET /reports/overview — one round-trip for every figure the
// dashboard shows, so the page doesn't fan out into a dozen queries that each
// re-scan the same table.
func (h *ReportHandler) Overview(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	w := parseWindow(c)

	// ── Headline counters, with the previous window for direction ──────────
	total := h.countEvents(orgID, w.Start, w.End, "")
	blocked := h.countEvents(orgID, w.Start, w.End, "action = ?", "blocked")
	alerted := h.countEvents(orgID, w.Start, w.End, "action = ?", "alerted")
	dlpEvents := h.countEvents(orgID, w.Start, w.End, "category = ?", "dlp")
	malware := h.countEvents(orgID, w.Start, w.End, "category = ?", "malware_detection")

	prevTotal := h.countEvents(orgID, w.PrevStart, w.PrevEnd, "")
	prevBlocked := h.countEvents(orgID, w.PrevStart, w.PrevEnd, "action = ?", "blocked")
	prevAlerted := h.countEvents(orgID, w.PrevStart, w.PrevEnd, "action = ?", "alerted")
	prevDLP := h.countEvents(orgID, w.PrevStart, w.PrevEnd, "category = ?", "dlp")

	var affectedUsers int64
	h.db.Model(&models.ActivityEvent{}).
		Where("org_id = ? AND timestamp >= ? AND timestamp < ? AND action IN ? AND employee_id IS NOT NULL",
			orgID, w.Start, w.End, []string{"blocked", "alerted"}).
		Distinct("employee_id").Count(&affectedUsers)

	// ── Estate coverage ────────────────────────────────────────────────────
	var employees, devices, onlineDevices, policies, enabledPolicies, pendingRequests int64
	h.db.Model(&models.Employee{}).Where("org_id = ?", orgID).Count(&employees)
	h.db.Model(&models.Device{}).Where("org_id = ?", orgID).Count(&devices)
	h.db.Model(&models.Device{}).Where("org_id = ? AND status = ?", orgID, "online").Count(&onlineDevices)
	h.db.Model(&models.Policy{}).Where("org_id = ?", orgID).Count(&policies)
	h.db.Model(&models.Policy{}).Where("org_id = ? AND enabled = true", orgID).Count(&enabledPolicies)
	h.db.Model(&models.AccessRequest{}).Where("org_id = ? AND status = ?", orgID, "pending").Count(&pendingRequests)

	var protectedEmployees int64
	h.db.Model(&models.Device{}).Where("org_id = ? AND employee_id IS NOT NULL", orgID).
		Distinct("employee_id").Count(&protectedEmployees)

	c.JSON(http.StatusOK, gin.H{
		"period": gin.H{
			"days":  w.Days,
			"start": w.Start,
			"end":   w.End,
		},
		"kpis": gin.H{
			"total_events":   total,
			"blocked":        blocked,
			"alerted":        alerted,
			"dlp_incidents":  dlpEvents,
			"malware":        malware,
			"affected_users": affectedUsers,
			"delta": gin.H{
				"total_events":  delta(total, prevTotal),
				"blocked":       delta(blocked, prevBlocked),
				"alerted":       delta(alerted, prevAlerted),
				"dlp_incidents": delta(dlpEvents, prevDLP),
			},
		},
		"coverage": gin.H{
			"employees":           employees,
			"protected_employees": protectedEmployees,
			"devices":             devices,
			"devices_online":      onlineDevices,
			"policies":            policies,
			"policies_enabled":    enabledPolicies,
			"pending_requests":    pendingRequests,
		},
		"trend":         h.trendByDay(orgID, w),
		"by_action":     h.groupCount(orgID, w, "action"),
		"by_category":   h.groupCount(orgID, w, "category"),
		"by_event_type": h.groupCount(orgID, w, "event_type"),
		"by_operation":  h.groupCount(orgID, w, "operation"),
		"top_domains":   h.topDomains(orgID, w, 10),
		"top_users":     h.topUsers(orgID, w, 10),
		"top_detectors": h.topDetectors(orgID, w, 8),
		"hourly":        h.hourlyPattern(orgID, w),
	})
}

type dayPoint struct {
	Date    string `json:"date"`
	Total   int    `json:"total"`
	Blocked int    `json:"blocked"`
	Alerted int    `json:"alerted"`
	Allowed int    `json:"allowed"`
}

// trendByDay returns one row per calendar day in the window, including days
// with no events — a line chart that silently skips empty days misrepresents
// a quiet weekend as a straight line between two busy weekdays.
func (h *ReportHandler) trendByDay(orgID string, w reportWindow) []dayPoint {
	type row struct {
		Day     time.Time
		Total   int
		Blocked int
		Alerted int
		Allowed int
	}
	var rows []row
	h.db.Raw(`SELECT DATE(timestamp) as day,
		COUNT(*) as total,
		COUNT(*) FILTER (WHERE action = 'blocked') as blocked,
		COUNT(*) FILTER (WHERE action = 'alerted') as alerted,
		COUNT(*) FILTER (WHERE action = 'allowed') as allowed
		FROM activity_events
		WHERE org_id = ? AND timestamp >= ? AND timestamp < ?
		GROUP BY DATE(timestamp) ORDER BY day ASC`, orgID, w.Start, w.End).Scan(&rows)

	byDay := make(map[string]row, len(rows))
	for _, r := range rows {
		byDay[r.Day.Format("2006-01-02")] = r
	}

	out := make([]dayPoint, 0, w.Days)
	for d := w.Start; d.Before(w.End); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		r := byDay[key]
		out = append(out, dayPoint{Date: key, Total: r.Total, Blocked: r.Blocked, Alerted: r.Alerted, Allowed: r.Allowed})
	}
	return out
}

type labelCount struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

// groupCount aggregates by a whitelisted column. The column name is
// interpolated into SQL, so it can never come straight from a query param.
func (h *ReportHandler) groupCount(orgID string, w reportWindow, column string) []labelCount {
	allowed := map[string]bool{"action": true, "category": true, "event_type": true, "operation": true}
	if !allowed[column] {
		return nil
	}
	// action and event_type are Postgres enums: comparing one to '' is a hard
	// error ("invalid input value for enum"), so every column is cast to text
	// before the empty-string filter.
	var rows []labelCount
	h.db.Raw(fmt.Sprintf(`SELECT %s::text as label, COUNT(*) as count
		FROM activity_events
		WHERE org_id = ? AND timestamp >= ? AND timestamp < ? AND %s::text <> ''
		GROUP BY %s::text ORDER BY count DESC`, column, column, column),
		orgID, w.Start, w.End).Scan(&rows)
	return rows
}

type domainCount struct {
	Domain  string `json:"domain"`
	App     string `json:"app"`
	Count   int    `json:"count"`
	Blocked int    `json:"blocked"`
}

func (h *ReportHandler) topDomains(orgID string, w reportWindow, limit int) []domainCount {
	var rows []domainCount
	h.db.Raw(`SELECT target_domain as domain,
		COUNT(*) as count,
		COUNT(*) FILTER (WHERE action = 'blocked') as blocked
		FROM activity_events
		WHERE org_id = ? AND timestamp >= ? AND timestamp < ?
		  AND target_domain <> '' AND action IN ('blocked','alerted')
		GROUP BY target_domain ORDER BY count DESC LIMIT ?`,
		orgID, w.Start, w.End, limit).Scan(&rows)
	return rows
}

type userRisk struct {
	EmployeeID string `json:"employee_id"`
	Name       string `json:"name"`
	Email      string `json:"email"`
	Department string `json:"department"`
	Incidents  int    `json:"incidents"`
	Blocked    int    `json:"blocked"`
	DLP        int    `json:"dlp"`
	MaxRisk    int    `json:"max_risk"`
}

func (h *ReportHandler) topUsers(orgID string, w reportWindow, limit int) []userRisk {
	var rows []userRisk
	h.db.Raw(`SELECT e.id as employee_id,
		TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) as name,
		e.email, e.department,
		COUNT(ae.id) as incidents,
		COUNT(*) FILTER (WHERE ae.action = 'blocked') as blocked,
		COUNT(*) FILTER (WHERE ae.category = 'dlp') as dlp,
		COALESCE(MAX(ae.risk_score), 0) as max_risk
		FROM activity_events ae
		JOIN employees e ON e.id = ae.employee_id
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ?
		  AND ae.action IN ('blocked','alerted')
		GROUP BY e.id, e.first_name, e.last_name, e.email, e.department
		ORDER BY incidents DESC LIMIT ?`,
		orgID, w.Start, w.End, limit).Scan(&rows)
	return rows
}

func (h *ReportHandler) topDetectors(orgID string, w reportWindow, limit int) []labelCount {
	var rows []labelCount
	h.db.Raw(`SELECT d as label, COUNT(*) as count
		FROM activity_events, LATERAL jsonb_array_elements_text(metadata->'detectors') as d
		WHERE org_id = ? AND timestamp >= ? AND timestamp < ?
		  AND jsonb_typeof(metadata->'detectors') = 'array'
		GROUP BY d ORDER BY count DESC LIMIT ?`,
		orgID, w.Start, w.End, limit).Scan(&rows)
	return rows
}

type hourPoint struct {
	Hour     int `json:"hour"`
	Total    int `json:"total"`
	Incident int `json:"incidents"`
}

// hourlyPattern shows when incidents happen across the day — off-hours activity
// is one of the few signals that separates routine use from something odd.
func (h *ReportHandler) hourlyPattern(orgID string, w reportWindow) []hourPoint {
	type row struct {
		Hour     int
		Total    int
		Incident int
	}
	var rows []row
	h.db.Raw(`SELECT EXTRACT(HOUR FROM timestamp)::int as hour,
		COUNT(*) as total,
		COUNT(*) FILTER (WHERE action IN ('blocked','alerted')) as incident
		FROM activity_events
		WHERE org_id = ? AND timestamp >= ? AND timestamp < ?
		GROUP BY hour ORDER BY hour`, orgID, w.Start, w.End).Scan(&rows)

	byHour := make(map[int]row, len(rows))
	for _, r := range rows {
		byHour[r.Hour] = r
	}
	out := make([]hourPoint, 0, 24)
	for i := 0; i < 24; i++ {
		r := byHour[i]
		out = append(out, hourPoint{Hour: i, Total: r.Total, Incident: r.Incident})
	}
	return out
}

// ─── Report catalog ───────────────────────────────────────────────────────────

type reportMeta struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
}

var reportCatalog = []reportMeta{
	{"executive", "Executive Summary", "Headline security posture for the period, with period-over-period movement", "layout-dashboard"},
	{"incidents", "Security Incidents", "Every blocked and alerted event with employee, destination and policy", "shield"},
	{"dlp", "Data Loss Prevention", "Sensitive-data incidents: detectors triggered, destinations and scores", "file-warning"},
	{"threats", "Threats & Malware", "Malware detections and threat-intelligence blocks", "bug"},
	{"shadow-it", "Shadow IT & SaaS", "Cloud apps in use, with sanction status and risk", "cloud"},
	{"employee-risk", "Employee Risk", "Incidents per employee, ranked — who needs coaching or attention", "users"},
	{"devices", "Device & Agent Coverage", "Enrolled devices, agent status and employees with no protection", "monitor"},
	{"policies", "Policy Effectiveness", "Which policies actually fire, and which never do", "file-text"},
	{"access-requests", "Access Requests", "Employee exception requests and how they were resolved", "inbox"},
}

// Catalog handles GET /reports/catalog
func (h *ReportHandler) Catalog(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"reports": reportCatalog})
}

// ─── Individual reports ───────────────────────────────────────────────────────

// reportTable is the shape every report returns: named columns plus rows, so
// one frontend renderer (and one CSV writer) handles all of them.
type reportTable struct {
	Columns []string         `json:"columns"`
	Rows    [][]any          `json:"rows"`
	Summary map[string]any   `json:"summary"`
	Charts  []map[string]any `json:"charts"`
}

// Report handles GET /reports/:type — JSON by default, CSV with ?format=csv.
func (h *ReportHandler) Report(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	w := parseWindow(c)
	reportType := c.Param("type")

	var (
		table reportTable
		err   error
	)
	switch reportType {
	case "executive":
		table = h.executiveReport(orgID, w)
	case "incidents":
		table = h.incidentsReport(orgID, w)
	case "dlp":
		table = h.dlpReport(orgID, w)
	case "threats":
		table = h.threatsReport(orgID, w)
	case "shadow-it":
		table = h.shadowITReport(orgID, w)
	case "employee-risk":
		table = h.employeeRiskReport(orgID, w)
	case "devices":
		table = h.devicesReport(orgID, w)
	case "policies":
		table = h.policiesReport(orgID, w)
	case "access-requests":
		table = h.accessRequestsReport(orgID, w)
	default:
		c.JSON(http.StatusNotFound, gin.H{"error": "Unknown report type"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build report"})
		return
	}

	if strings.EqualFold(c.Query("format"), "csv") {
		h.writeCSV(c, reportType, w, table)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"report":  reportType,
		"period":  gin.H{"days": w.Days, "start": w.Start, "end": w.End},
		"columns": table.Columns,
		"rows":    table.Rows,
		"summary": table.Summary,
		"charts":  table.Charts,
		"total":   len(table.Rows),
	})
}

func (h *ReportHandler) writeCSV(c *gin.Context, reportType string, w reportWindow, table reportTable) {
	filename := fmt.Sprintf("%s-report_%s_to_%s.csv", reportType,
		w.Start.Format("2006-01-02"), w.End.Format("2006-01-02"))

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")

	cw := csv.NewWriter(c.Writer)
	defer cw.Flush()

	// A couple of provenance lines first: an exported CSV that lands in an
	// audit folder should say what it covers without needing the email it
	// arrived in.
	_ = cw.Write([]string{"Report", reportType})
	_ = cw.Write([]string{"Period", w.Start.Format(time.RFC3339), "to", w.End.Format(time.RFC3339)})
	_ = cw.Write([]string{"Generated", time.Now().Format(time.RFC3339)})
	_ = cw.Write([]string{})
	_ = cw.Write(table.Columns)

	for _, row := range table.Rows {
		record := make([]string, 0, len(row))
		for _, cell := range row {
			record = append(record, fmt.Sprintf("%v", cell))
		}
		_ = cw.Write(record)
	}
}

func (h *ReportHandler) executiveReport(orgID string, w reportWindow) reportTable {
	total := h.countEvents(orgID, w.Start, w.End, "")
	blocked := h.countEvents(orgID, w.Start, w.End, "action = ?", "blocked")
	alerted := h.countEvents(orgID, w.Start, w.End, "action = ?", "alerted")
	dlp := h.countEvents(orgID, w.Start, w.End, "category = ?", "dlp")
	malware := h.countEvents(orgID, w.Start, w.End, "category = ?", "malware_detection")

	prevBlocked := h.countEvents(orgID, w.PrevStart, w.PrevEnd, "action = ?", "blocked")
	prevAlerted := h.countEvents(orgID, w.PrevStart, w.PrevEnd, "action = ?", "alerted")
	prevDLP := h.countEvents(orgID, w.PrevStart, w.PrevEnd, "category = ?", "dlp")
	prevMalware := h.countEvents(orgID, w.PrevStart, w.PrevEnd, "category = ?", "malware_detection")

	fmtDelta := func(d *float64) string {
		if d == nil {
			return "no prior data"
		}
		if *d > 0 {
			return fmt.Sprintf("+%.1f%%", *d)
		}
		return fmt.Sprintf("%.1f%%", *d)
	}

	rows := [][]any{
		{"Total events", total, "—"},
		{"Blocked", blocked, fmtDelta(delta(blocked, prevBlocked))},
		{"Alerted", alerted, fmtDelta(delta(alerted, prevAlerted))},
		{"DLP incidents", dlp, fmtDelta(delta(dlp, prevDLP))},
		{"Malware detections", malware, fmtDelta(delta(malware, prevMalware))},
	}

	var employees, devices, pending int64
	h.db.Model(&models.Employee{}).Where("org_id = ?", orgID).Count(&employees)
	h.db.Model(&models.Device{}).Where("org_id = ?", orgID).Count(&devices)
	h.db.Model(&models.AccessRequest{}).Where("org_id = ? AND status = ?", orgID, "pending").Count(&pending)
	rows = append(rows,
		[]any{"Employees", employees, "—"},
		[]any{"Enrolled devices", devices, "—"},
		[]any{"Pending access requests", pending, "—"},
	)

	return reportTable{
		Columns: []string{"Metric", "Value", "vs previous period"},
		Rows:    rows,
		Summary: map[string]any{
			"total_events": total, "blocked": blocked, "alerted": alerted,
			"dlp": dlp, "malware": malware,
		},
		Charts: []map[string]any{
			{"type": "trend", "title": "Daily activity", "data": h.trendByDay(orgID, w)},
			{"type": "category", "title": "Incidents by category", "data": h.groupCount(orgID, w, "category")},
		},
	}
}

func (h *ReportHandler) incidentsReport(orgID string, w reportWindow) reportTable {
	type row struct {
		Timestamp time.Time
		Name      string
		Email     string
		Domain    string
		Operation string
		Category  string
		Action    string
		Policy    string
		Risk      float64
	}
	var rows []row
	h.db.Raw(`SELECT ae.timestamp,
		TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) as name,
		COALESCE(e.email,'') as email,
		ae.target_domain as domain, ae.operation, ae.category, ae.action,
		ae.policy_name as policy, ae.risk_score as risk
		FROM activity_events ae
		LEFT JOIN employees e ON e.id = ae.employee_id
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ?
		  AND ae.action IN ('blocked','alerted')
		ORDER BY ae.timestamp DESC LIMIT 5000`, orgID, w.Start, w.End).Scan(&rows)

	out := make([][]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, []any{
			r.Timestamp.Format(time.RFC3339), r.Name, r.Email, r.Domain,
			r.Operation, r.Category, r.Action, r.Policy, int(r.Risk),
		})
	}
	return reportTable{
		Columns: []string{"Time", "Employee", "Email", "Destination", "Operation", "Category", "Action", "Policy", "Risk"},
		Rows:    out,
		Summary: map[string]any{"incidents": len(out)},
		Charts: []map[string]any{
			{"type": "trend", "title": "Incidents per day", "data": h.trendByDay(orgID, w)},
			{"type": "top_domains", "title": "Most-hit destinations", "data": h.topDomains(orgID, w, 10)},
		},
	}
}

func (h *ReportHandler) dlpReport(orgID string, w reportWindow) reportTable {
	type row struct {
		Timestamp time.Time
		Name      string
		File      string
		Domain    string
		Operation string
		Action    string
		Policy    string
		Score     float64
		Detectors string
	}
	var rows []row
	h.db.Raw(`SELECT ae.timestamp,
		TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) as name,
		ae.target as file, ae.target_domain as domain, ae.operation, ae.action,
		ae.policy_name as policy, ae.risk_score as score,
		COALESCE((SELECT string_agg(d, ', ') FROM jsonb_array_elements_text(ae.metadata->'detectors') d), '') as detectors
		FROM activity_events ae
		LEFT JOIN employees e ON e.id = ae.employee_id
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ? AND ae.category = 'dlp'
		ORDER BY ae.timestamp DESC LIMIT 5000`, orgID, w.Start, w.End).Scan(&rows)

	out := make([][]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, []any{
			r.Timestamp.Format(time.RFC3339), r.Name, r.File, r.Domain,
			r.Operation, r.Action, r.Policy, int(r.Score), r.Detectors,
		})
	}
	return reportTable{
		Columns: []string{"Time", "Employee", "File", "Destination", "Operation", "Action", "Policy", "Score", "Detectors"},
		Rows:    out,
		Summary: map[string]any{"incidents": len(out)},
		Charts: []map[string]any{
			{"type": "detectors", "title": "Detectors triggered", "data": h.topDetectors(orgID, w, 8)},
			{"type": "operations", "title": "How data was leaving", "data": h.groupCount(orgID, w, "operation")},
		},
	}
}

func (h *ReportHandler) threatsReport(orgID string, w reportWindow) reportTable {
	type row struct {
		Timestamp time.Time
		Name      string
		Target    string
		Domain    string
		Action    string
		Category  string
		Risk      float64
		Reason    string
	}
	var rows []row
	h.db.Raw(`SELECT ae.timestamp,
		TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) as name,
		ae.target, ae.target_domain as domain, ae.action, ae.category,
		ae.risk_score as risk, ae.policy_name as reason
		FROM activity_events ae
		LEFT JOIN employees e ON e.id = ae.employee_id
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ?
		  AND (ae.category IN ('malware_detection','threat_intelligence') OR ae.risk_score >= 70)
		ORDER BY ae.risk_score DESC, ae.timestamp DESC LIMIT 5000`, orgID, w.Start, w.End).Scan(&rows)

	out := make([][]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, []any{
			r.Timestamp.Format(time.RFC3339), r.Name, r.Target, r.Domain,
			r.Category, r.Action, int(r.Risk), r.Reason,
		})
	}
	return reportTable{
		Columns: []string{"Time", "Employee", "Target", "Domain", "Category", "Action", "Risk", "Reason"},
		Rows:    out,
		Summary: map[string]any{"detections": len(out)},
	}
}

func (h *ReportHandler) shadowITReport(orgID string, w reportWindow) reportTable {
	type row struct {
		Domain string
		Events int
		Users  int
		First  time.Time
		Last   time.Time
	}
	var rows []row
	h.db.Raw(`SELECT target_domain as domain, COUNT(*) as events,
		COUNT(DISTINCT employee_id) as users,
		MIN(timestamp) as first, MAX(timestamp) as last
		FROM activity_events
		WHERE org_id = ? AND timestamp >= ? AND timestamp < ? AND target_domain <> ''
		GROUP BY target_domain ORDER BY events DESC LIMIT 500`, orgID, w.Start, w.End).Scan(&rows)

	// Sanction status comes from the same domain rules the Shadow IT page reads,
	// so an exported report and the screen never disagree.
	domains := make([]string, 0, len(rows))
	for _, r := range rows {
		domains = append(domains, r.Domain)
	}
	statusOf := map[string]string{}
	if len(domains) > 0 {
		var rules []models.DomainRule
		h.db.Where("(org_id = ? OR org_id IS NULL) AND domain IN ?", orgID, domains).Find(&rules)
		for _, rule := range rules {
			switch rule.Action {
			case models.PolicyActionBlock:
				statusOf[rule.Domain] = "blocked"
			case models.PolicyActionAllow:
				if statusOf[rule.Domain] == "" {
					statusOf[rule.Domain] = "sanctioned"
				}
			}
		}
	}

	out := make([][]any, 0, len(rows))
	for _, r := range rows {
		status := statusOf[r.Domain]
		if status == "" {
			status = "unreviewed"
		}
		out = append(out, []any{
			r.Domain, status, r.Events, r.Users,
			r.First.Format("2006-01-02"), r.Last.Format("2006-01-02"),
		})
	}
	return reportTable{
		Columns: []string{"Domain", "Status", "Events", "Users", "First seen", "Last seen"},
		Rows:    out,
		Summary: map[string]any{"apps": len(out)},
	}
}

func (h *ReportHandler) employeeRiskReport(orgID string, w reportWindow) reportTable {
	users := h.topUsers(orgID, w, 500)
	out := make([][]any, 0, len(users))
	for _, u := range users {
		out = append(out, []any{u.Name, u.Email, u.Department, u.Incidents, u.Blocked, u.DLP, u.MaxRisk})
	}
	return reportTable{
		Columns: []string{"Employee", "Email", "Department", "Incidents", "Blocked", "DLP incidents", "Highest risk score"},
		Rows:    out,
		Summary: map[string]any{"employees_with_incidents": len(out)},
		Charts: []map[string]any{
			{"type": "top_users", "title": "Incidents by employee", "data": h.topUsers(orgID, w, 10)},
		},
	}
}

func (h *ReportHandler) devicesReport(orgID string, w reportWindow) reportTable {
	type row struct {
		Hostname     string
		Name         string
		OSType       string
		OSVersion    string
		AgentVersion string
		Status       string
		PostureScore int
		LastSeenAt   *time.Time
		EnrolledAt   time.Time
	}
	var rows []row
	h.db.Raw(`SELECT d.hostname,
		TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) as name,
		d.os_type, d.os_version, d.agent_version, d.status, d.posture_score,
		d.last_seen_at, d.enrolled_at
		FROM devices d
		LEFT JOIN employees e ON e.id = d.employee_id
		WHERE d.org_id = ? ORDER BY d.last_seen_at DESC NULLS LAST`, orgID).Scan(&rows)

	out := make([][]any, 0, len(rows))
	for _, r := range rows {
		lastSeen := "never"
		if r.LastSeenAt != nil {
			lastSeen = r.LastSeenAt.Format(time.RFC3339)
		}
		out = append(out, []any{
			r.Hostname, r.Name, r.OSType, r.OSVersion, r.AgentVersion,
			r.Status, r.PostureScore, lastSeen, r.EnrolledAt.Format("2006-01-02"),
		})
	}

	// Employees with no device are the actual coverage gap, and they're
	// invisible in a list of devices — so they get counted explicitly.
	var unprotected int64
	h.db.Raw(`SELECT COUNT(*) FROM employees e
		WHERE e.org_id = ? AND NOT EXISTS (
			SELECT 1 FROM devices d WHERE d.employee_id = e.id AND d.deleted_at IS NULL)`,
		orgID).Scan(&unprotected)

	return reportTable{
		Columns: []string{"Hostname", "Employee", "OS", "OS version", "Agent version", "Status", "Posture score", "Last seen", "Enrolled"},
		Rows:    out,
		Summary: map[string]any{"devices": len(out), "employees_without_device": unprotected},
	}
}

func (h *ReportHandler) policiesReport(orgID string, w reportWindow) reportTable {
	type row struct {
		Name     string
		Type     string
		Action   string
		Priority int
		Enabled  bool
		Hits     int
	}
	var rows []row
	h.db.Raw(`SELECT p.name, p.type, p.action, p.priority, p.enabled,
		COALESCE(COUNT(ae.id), 0) as hits
		FROM policies p
		LEFT JOIN activity_events ae
		  ON ae.policy_id = p.id AND ae.timestamp >= ? AND ae.timestamp < ?
		WHERE p.org_id = ?
		GROUP BY p.id, p.name, p.type, p.action, p.priority, p.enabled
		ORDER BY hits DESC, p.priority ASC`, w.Start, w.End, orgID).Scan(&rows)

	out := make([][]any, 0, len(rows))
	for _, r := range rows {
		state := "enabled"
		if !r.Enabled {
			state = "disabled"
		}
		out = append(out, []any{r.Name, r.Type, r.Action, r.Priority, state, r.Hits})
	}
	return reportTable{
		Columns: []string{"Policy", "Type", "Action", "Priority", "State", "Times triggered"},
		Rows:    out,
		Summary: map[string]any{"policies": len(out)},
	}
}

func (h *ReportHandler) accessRequestsReport(orgID string, w reportWindow) reportTable {
	type row struct {
		CreatedAt  time.Time
		Name       string
		Email      string
		Domain     string
		Reason     string
		Status     string
		ReviewedAt *time.Time
	}
	var rows []row
	h.db.Raw(`SELECT ar.created_at,
		TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) as name,
		COALESCE(e.email,'') as email,
		ar.domain, ar.reason, ar.status, ar.reviewed_at
		FROM access_requests ar
		LEFT JOIN employees e ON e.id = ar.employee_id
		WHERE ar.org_id = ? AND ar.created_at >= ? AND ar.created_at < ?
		ORDER BY ar.created_at DESC`, orgID, w.Start, w.End).Scan(&rows)

	out := make([][]any, 0, len(rows))
	for _, r := range rows {
		reviewed := "—"
		if r.ReviewedAt != nil {
			reviewed = r.ReviewedAt.Format(time.RFC3339)
		}
		out = append(out, []any{
			r.CreatedAt.Format(time.RFC3339), r.Name, r.Email, r.Domain, r.Reason, r.Status, reviewed,
		})
	}
	return reportTable{
		Columns: []string{"Requested", "Employee", "Email", "Domain", "Reason", "Status", "Reviewed"},
		Rows:    out,
		Summary: map[string]any{"requests": len(out)},
	}
}
