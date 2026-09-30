package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // report periods are computed in the viewer's zone; the alpine image has no zoneinfo

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ReportHandler backs the dashboard overview and the Reports section.
//
// Every figure is grouped by *control* (DLP, web filtering, app control, VPN,
// threats, device health) rather than by raw action: an admin acts on "3 VPN
// bypass attempts", not on "21 blocked, 24 alerted". Counts are compared with
// the window of equal length just before, because a number alone says less
// than its direction.
type ReportHandler struct {
	db *gorm.DB
}

func NewReportHandler(db *gorm.DB) *ReportHandler { return &ReportHandler{db: db} }

// ─── Period ───────────────────────────────────────────────────────────────────

// reportWindow is the period being reported on, the equal-length period
// before it, and the time zone its days are counted in.
type reportWindow struct {
	Start, End         time.Time
	PrevStart, PrevEnd time.Time
	Loc                *time.Location
	// Hourly is true for spans of two days or less, where a per-day chart
	// would be one or two bars.
	Hourly bool
}

const maxReportSpan = 366 * 24 * time.Hour

// parseWindow reads ?start=&end= (RFC3339, or YYYY-MM-DD read as whole days in
// the zone, end inclusive) or the older ?days=, plus ?tz=. The zone falls back
// to the organization's configured zone, then UTC.
func (h *ReportHandler) parseWindow(c *gin.Context, orgID string) reportWindow {
	loc := time.UTC
	if tz := c.Query("tz"); tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	} else {
		var org models.Organization
		if h.db.Select("timezone").First(&org, "id = ?", orgID).Error == nil && org.Timezone != "" {
			if l, err := time.LoadLocation(org.Timezone); err == nil {
				loc = l
			}
		}
	}

	parse := func(v string, endOfDay bool) (time.Time, bool) {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			return t, true
		}
		if d, err := time.ParseInLocation("2006-01-02", v, loc); err == nil {
			if endOfDay {
				d = d.AddDate(0, 0, 1)
			}
			return d, true
		}
		return time.Time{}, false
	}

	now := time.Now()
	end := now
	if v := c.Query("end"); v != "" {
		if t, ok := parse(v, true); ok {
			end = t
		}
	}
	var start time.Time
	if v := c.Query("start"); v != "" {
		if t, ok := parse(v, false); ok {
			start = t
		}
	}
	if start.IsZero() {
		days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
		if days <= 0 || days > 366 {
			days = 30
		}
		start = end.AddDate(0, 0, -days)
	}
	if !start.Before(end) {
		start = end.Add(-24 * time.Hour)
	}
	if end.Sub(start) > maxReportSpan {
		start = end.Add(-maxReportSpan)
	}
	span := end.Sub(start)
	return reportWindow{
		Start: start, End: end,
		PrevStart: start.Add(-span), PrevEnd: start,
		Loc:    loc,
		Hourly: span <= 48*time.Hour,
	}
}

func (w reportWindow) meta() gin.H {
	bucket := "day"
	if w.Hourly {
		bucket = "hour"
	}
	return gin.H{"start": w.Start, "end": w.End, "tz": w.Loc.String(), "bucket": bucket}
}

// fmtTime renders a timestamp the way a person reads it in an export.
func (w reportWindow) fmtTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.In(w.Loc).Format("2006-01-02 15:04")
}

// delta is percent change, nil when there is no baseline: a first-ever week
// has no trend, and "+100%" or "0%" would both be made up.
func delta(current, previous int64) *float64 {
	if previous == 0 {
		return nil
	}
	d := (float64(current) - float64(previous)) / float64(previous) * 100
	rounded := float64(int(d*10)) / 10
	return &rounded
}

// ─── Controls ─────────────────────────────────────────────────────────────────

type control struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// controls, in display order. The IDs are what controlSQL yields.
var controls = []control{
	{"dlp", "Data protection"},
	{"web", "Web filtering"},
	{"apps", "App control"},
	{"vpn", "VPN & bypass"},
	{"threats", "Malware & threats"},
	{"devices", "Device health"},
}

func controlLabel(id string) string {
	for _, c := range controls {
		if c.ID == id {
			return c.Label
		}
	}
	return id
}

// controlSQL maps an activity_events row (aliased ae) to the control that
// produced it. VPN is carved out of app control because a bypass attempt is
// a different conversation with an employee than a blocked chat app.
const controlSQL = `(CASE
	WHEN ae.category = 'dlp' THEN 'dlp'
	WHEN ae.category IN ('malware_detection','threat_intelligence') THEN 'threats'
	WHEN ae.category = 'vpn' OR ae.operation ILIKE '%vpn%'
	  OR (ae.category = 'application_control' AND ae.target ILIKE '%vpn%') THEN 'vpn'
	WHEN ae.category = 'application_control' THEN 'apps'
	WHEN ae.category IN ('device','device_posture') THEN 'devices'
	ELSE 'web' END)`

// incidentSQL is what counts as an incident: something was stopped or
// flagged. Routine "logged" device events are context, not incidents.
const incidentSQL = `ae.action IN ('blocked','alerted')`

func validControl(id string) bool {
	for _, c := range controls {
		if c.ID == id {
			return true
		}
	}
	return false
}

type controlCount struct {
	Control string
	N       int64
	Blocked int64
	Alerted int64
}

func (h *ReportHandler) countByControl(orgID string, from, to time.Time) map[string]controlCount {
	var rows []controlCount
	h.db.Raw(`SELECT `+controlSQL+` AS control, COUNT(*) AS n,
		COUNT(*) FILTER (WHERE ae.action = 'blocked') AS blocked,
		COUNT(*) FILTER (WHERE ae.action = 'alerted') AS alerted
		FROM activity_events ae
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ? AND `+incidentSQL+`
		GROUP BY 1`, orgID, from, to).Scan(&rows)
	out := make(map[string]controlCount, len(rows))
	for _, r := range rows {
		out[r.Control] = r
	}
	return out
}

type controlStat struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Count   int64    `json:"count"`
	Blocked int64    `json:"blocked"`
	Alerted int64    `json:"alerted"`
	Prev    int64    `json:"prev"`
	Delta   *float64 `json:"delta"`
}

func (h *ReportHandler) controlStats(orgID string, w reportWindow) ([]controlStat, int64, int64) {
	cur := h.countByControl(orgID, w.Start, w.End)
	prev := h.countByControl(orgID, w.PrevStart, w.PrevEnd)
	out := make([]controlStat, 0, len(controls))
	var total, prevTotal int64
	for _, c := range controls {
		n, p := cur[c.ID], prev[c.ID]
		total += n.N
		prevTotal += p.N
		out = append(out, controlStat{
			ID: c.ID, Label: c.Label, Count: n.N, Blocked: n.Blocked, Alerted: n.Alerted,
			Prev: p.N, Delta: delta(n.N, p.N),
		})
	}
	return out, total, prevTotal
}

// trend returns one point per day (or hour) in the window, including empty
// ones, with a count per control. A chart that skips empty days draws a quiet
// weekend as a straight line between two busy weekdays.
func (h *ReportHandler) trend(orgID string, w reportWindow, where string, args ...any) []map[string]any {
	unit := "day"
	if w.Hourly {
		unit = "hour"
	}
	type row struct {
		Bucket  time.Time
		Control string
		N       int
	}
	var rows []row
	q := `SELECT date_trunc('` + unit + `', ae.timestamp AT TIME ZONE ?) AS bucket, ` + controlSQL + ` AS control, COUNT(*) AS n
		FROM activity_events ae
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ? AND ` + incidentSQL
	params := []any{w.Loc.String(), orgID, w.Start, w.End}
	if where != "" {
		q += " AND " + where
		params = append(params, args...)
	}
	h.db.Raw(q+" GROUP BY 1, 2", params...).Scan(&rows)

	layout := "2006-01-02"
	if w.Hourly {
		layout = "2006-01-02T15:00"
	}
	// AT TIME ZONE yields a zone-less wall-clock time, which the driver hands
	// back as UTC; its fields are the local fields, so format them as-is.
	byKey := map[string]map[string]any{}
	for _, r := range rows {
		k := r.Bucket.UTC().Format(layout)
		if byKey[k] == nil {
			byKey[k] = map[string]any{}
		}
		byKey[k][r.Control] = r.N
	}

	step := func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }
	cur := time.Date(w.Start.In(w.Loc).Year(), w.Start.In(w.Loc).Month(), w.Start.In(w.Loc).Day(), 0, 0, 0, 0, w.Loc)
	if w.Hourly {
		s := w.Start.In(w.Loc)
		cur = time.Date(s.Year(), s.Month(), s.Day(), s.Hour(), 0, 0, 0, w.Loc)
		step = func(t time.Time) time.Time { return t.Add(time.Hour) }
	}
	out := []map[string]any{}
	for ; cur.Before(w.End) && len(out) < 400; cur = step(cur) {
		k := cur.Format(layout)
		p := map[string]any{"t": k, "total": 0}
		total := 0
		for _, c := range controls {
			n, _ := byKey[k][c.ID].(int)
			p[c.ID] = n
			total += n
		}
		p["total"] = total
		out = append(out, p)
	}
	return out
}

// ─── Overview (dashboard) ─────────────────────────────────────────────────────

type health struct {
	Devices               int64 `json:"devices"`
	Online                int64 `json:"online"`
	Stale                 int64 `json:"stale"`
	PostureIssues         int64 `json:"posture_issues"`
	Employees             int64 `json:"employees"`
	EmployeesWithoutAgent int64 `json:"employees_without_agent"`
	PendingRequests       int64 `json:"pending_requests"`
	Policies              int64 `json:"policies"`
	PoliciesEnabled       int64 `json:"policies_enabled"`
}

// staleAfter is how long a device can go without checking in before it
// counts as unprotected rather than merely asleep.
const staleAfter = 7 * 24 * time.Hour

func (h *ReportHandler) health(orgID string) health {
	var r health
	h.db.Model(&models.Device{}).Where("org_id = ?", orgID).Count(&r.Devices)
	h.db.Model(&models.Device{}).Where("org_id = ? AND status = ?", orgID, "online").Count(&r.Online)
	h.db.Model(&models.Device{}).Where("org_id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)", orgID, time.Now().Add(-staleAfter)).Count(&r.Stale)
	h.db.Model(&models.Device{}).Where(`org_id = ? AND (
		jsonb_array_length((CASE WHEN jsonb_typeof(metadata->'posture_failed') = 'array' THEN metadata->'posture_failed' ELSE '[]'::jsonb END)) > 0
		OR metadata->>'posture_status' = 'fail')`, orgID).Count(&r.PostureIssues)
	h.db.Model(&models.Employee{}).Where("org_id = ?", orgID).Count(&r.Employees)
	h.db.Raw(`SELECT COUNT(*) FROM employees e WHERE e.org_id = ? AND e.deleted_at IS NULL AND NOT EXISTS (
		SELECT 1 FROM devices d WHERE d.employee_id = e.id AND d.deleted_at IS NULL)`, orgID).Scan(&r.EmployeesWithoutAgent)
	h.db.Model(&models.AccessRequest{}).Where("org_id = ? AND status = ?", orgID, "pending").Count(&r.PendingRequests)
	h.db.Model(&models.Policy{}).Where("org_id = ?", orgID).Count(&r.Policies)
	h.db.Model(&models.Policy{}).Where("org_id = ? AND enabled = true", orgID).Count(&r.PoliciesEnabled)
	return r
}

type attentionItem struct {
	Severity string `json:"severity"` // high | medium
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	Href     string `json:"href"`
}

func plural(n int64, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

// attention is the short list of things an admin should act on, most urgent
// first. Each item links to the page where it gets fixed.
func (h *ReportHandler) attention(orgID string, w reportWindow, hl health, stats []controlStat) []attentionItem {
	items := []attentionItem{}
	if hl.Policies > 0 && hl.PoliciesEnabled == 0 {
		items = append(items, attentionItem{"high", "No policy is switched on", "Devices are enrolled but nothing is being enforced.", "/dashboard/swg"})
	}

	type failing struct {
		Hostname string
		Failed   string
	}
	var fails []failing
	h.db.Raw(`SELECT hostname, COALESCE((SELECT string_agg(f, ', ') FROM jsonb_array_elements_text((CASE WHEN jsonb_typeof(metadata->'posture_failed') = 'array' THEN metadata->'posture_failed' ELSE '[]'::jsonb END)) f), '') AS failed
		FROM devices WHERE org_id = ? AND deleted_at IS NULL
		AND jsonb_array_length((CASE WHEN jsonb_typeof(metadata->'posture_failed') = 'array' THEN metadata->'posture_failed' ELSE '[]'::jsonb END)) > 0
		ORDER BY hostname LIMIT 3`, orgID).Scan(&fails)
	if len(fails) > 0 {
		parts := make([]string, 0, len(fails))
		for _, f := range fails {
			parts = append(parts, fmt.Sprintf("%s: %s", f.Hostname, strings.ReplaceAll(f.Failed, "_", " ")))
		}
		items = append(items, attentionItem{"high", plural(hl.PostureIssues, "device fails a security check", "devices fail a security check"), strings.Join(parts, "; "), "/dashboard/devices"})
	}

	var highDLP int64
	h.db.Raw(`SELECT COUNT(*) FROM activity_events ae WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ?
		AND ae.category = 'dlp' AND (ae.metadata->>'band' = 'block' OR ae.risk_score >= 80)`, orgID, w.Start, w.End).Scan(&highDLP)
	if highDLP > 0 {
		items = append(items, attentionItem{"high", plural(highDLP, "high-severity data leak", "high-severity data leaks") + " flagged", "Sensitive data that would normally be blocked left through a monitored channel.", "/dashboard/dlp"})
	}
	for _, s := range stats {
		if s.ID == "threats" && s.Count > 0 {
			items = append(items, attentionItem{"high", plural(s.Count, "malware or threat detection", "malware or threat detections"), "Review the affected devices and downloads.", "/dashboard/activity"})
		}
		if s.ID == "vpn" && s.Count > 0 {
			items = append(items, attentionItem{"medium", plural(s.Count, "VPN bypass attempt", "VPN bypass attempts"), "Employees tried to install or run a VPN to get around policy.", "/dashboard/activity"})
		}
	}
	if hl.PendingRequests > 0 {
		items = append(items, attentionItem{"medium", plural(hl.PendingRequests, "access request is", "access requests are") + " waiting", "Employees are blocked until someone decides.", "/dashboard/access-requests"})
	}
	if hl.Stale > 0 {
		items = append(items, attentionItem{"medium", plural(hl.Stale, "device hasn't", "devices haven't") + " checked in for 7+ days", "They are not receiving policy updates. Check the agent is still installed.", "/dashboard/devices"})
	}
	if hl.EmployeesWithoutAgent > 0 && hl.Devices > 0 {
		items = append(items, attentionItem{"medium", plural(hl.EmployeesWithoutAgent, "employee has", "employees have") + " no protected device", "Send them the enrollment link from the Employees page.", "/dashboard/employees"})
	}
	return items
}

// Overview handles GET /reports/overview: everything the dashboard shows in
// one round trip.
func (h *ReportHandler) Overview(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	w := h.parseWindow(c, orgID)

	stats, total, prevTotal := h.controlStats(orgID, w)
	hl := h.health(orgID)

	var affected int64
	h.db.Raw(`SELECT COUNT(DISTINCT ae.employee_id) FROM activity_events ae
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ? AND `+incidentSQL+` AND ae.employee_id IS NOT NULL`,
		orgID, w.Start, w.End).Scan(&affected)

	c.JSON(http.StatusOK, gin.H{
		"period":       w.meta(),
		"health":       hl,
		"attention":    h.attention(orgID, w, hl, stats),
		"controls":     stats,
		"totals":       gin.H{"incidents": total, "prev": prevTotal, "delta": delta(total, prevTotal), "affected_employees": affected},
		"trend":        h.trend(orgID, w, ""),
		"top_apps":     h.topApps(orgID, w, 6),
		"top_sites":    h.topSites(orgID, w, 6),
		"dlp_services": h.dlpServices(orgID, w, 6),
		"dlp_types":    h.dlpTypes(orgID, w, 6),
		"top_users":    h.topUsers(orgID, w, 6),
	})
}

// ─── Ranked lists shared by the dashboard and reports ───────────────────────

type appRow struct {
	Name      string    `json:"name"`
	Control   string    `json:"control"`
	Count     int       `json:"count"`
	Employees int       `json:"employees"`
	Last      time.Time `json:"last"`
}

func (h *ReportHandler) topApps(orgID string, w reportWindow, limit int) []appRow {
	var rows []appRow
	h.db.Raw(`SELECT ae.target AS name, `+controlSQL+` AS control, COUNT(*) AS count,
		COUNT(DISTINCT ae.employee_id) AS employees, MAX(ae.timestamp) AS last
		FROM activity_events ae
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ? AND `+incidentSQL+`
		  AND ae.category = 'application_control' AND ae.target <> ''
		GROUP BY 1, 2 ORDER BY count DESC LIMIT ?`, orgID, w.Start, w.End, limit).Scan(&rows)
	return rows
}

type siteRow struct {
	Domain    string    `json:"domain"`
	Category  string    `json:"category"`
	Count     int       `json:"count"`
	Employees int       `json:"employees"`
	Last      time.Time `json:"last"`
}

// siteCategorySQL names why a site was blocked. Web events carry the policy
// ("Policy: Social media") rather than a separate category field.
const siteCategorySQL = `COALESCE(NULLIF(TRIM(REGEXP_REPLACE(MAX(ae.policy_name), '^Policy:\s*', '', 'i')), ''), MAX(ae.category), '')`

func (h *ReportHandler) topSites(orgID string, w reportWindow, limit int) []siteRow {
	var rows []siteRow
	h.db.Raw(`SELECT ae.target_domain AS domain, `+siteCategorySQL+` AS category, COUNT(*) AS count,
		COUNT(DISTINCT ae.employee_id) AS employees, MAX(ae.timestamp) AS last
		FROM activity_events ae
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ? AND `+incidentSQL+`
		  AND `+controlSQL+` = 'web' AND ae.target_domain <> ''
		GROUP BY ae.target_domain ORDER BY count DESC LIMIT ?`, orgID, w.Start, w.End, limit).Scan(&rows)
	return rows
}

type serviceRow struct {
	Service string `json:"service"`
	Count   int    `json:"count"`
	High    int    `json:"high"`
}

// dlpServiceSQL is where sensitive data was going: the service DLP recognised
// (Gmail, ChatGPT...), else the destination domain.
const dlpServiceSQL = `COALESCE(NULLIF(ae.metadata->>'service',''), NULLIF(ae.metadata->>'app_name',''), NULLIF(ae.target_domain,''), 'Unknown')`

func (h *ReportHandler) dlpServices(orgID string, w reportWindow, limit int) []serviceRow {
	var rows []serviceRow
	h.db.Raw(`SELECT `+dlpServiceSQL+` AS service, COUNT(*) AS count,
		COUNT(*) FILTER (WHERE ae.metadata->>'band' = 'block' OR ae.risk_score >= 80) AS high
		FROM activity_events ae
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ? AND ae.category = 'dlp'
		GROUP BY 1 ORDER BY count DESC LIMIT ?`, orgID, w.Start, w.End, limit).Scan(&rows)
	return rows
}

type labelCount struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

func (h *ReportHandler) dlpTypes(orgID string, w reportWindow, limit int) []labelCount {
	var rows []labelCount
	h.db.Raw(`SELECT d AS label, COUNT(*) AS count
		FROM activity_events ae, LATERAL jsonb_array_elements_text(
			CASE WHEN jsonb_typeof(ae.metadata->'detectors') = 'array' THEN ae.metadata->'detectors' ELSE '[]'::jsonb END) AS d
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ? AND ae.category = 'dlp'
		GROUP BY 1 ORDER BY count DESC LIMIT ?`, orgID, w.Start, w.End, limit).Scan(&rows)
	for i := range rows {
		rows[i].Label = detectorLabel(rows[i].Label)
	}
	return rows
}

// detectorNames gives DLP detector IDs the names an admin would use.
var detectorNames = map[string]string{
	"ai_text": "AI-detected text", "ai_visual": "AI-detected image", "ai_audio": "AI-detected audio",
	"credit_card": "Credit card", "aadhaar": "Aadhaar", "aadhaar_card": "Aadhaar card",
	"pan_india": "PAN (India)", "pan_card": "PAN card", "id_card": "ID card", "driving_licence": "Driving licence",
	"github_token": "GitHub token", "generic_api_key": "API key", "source_code": "Source code",
	"salary_data": "Salary data", "employee_pii": "Employee personal data", "customer_pii": "Customer personal data",
	"health_data": "Health data", "legal_privileged": "Legal (privileged)", "trade_secret": "Trade secret",
	"merger_acquisition": "M&A information", "security_report": "Security report",
	"encrypted_archive": "Encrypted archive", "encrypted_document": "Encrypted document", "custom_regex": "Custom pattern",
}

func detectorLabel(id string) string {
	if n, ok := detectorNames[id]; ok {
		return n
	}
	s := strings.ReplaceAll(id, "_", " ")
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

type userRisk struct {
	EmployeeID string    `json:"employee_id"`
	Name       string    `json:"name"`
	Email      string    `json:"email"`
	Department string    `json:"department"`
	Incidents  int       `json:"incidents"`
	DLP        int       `json:"dlp"`
	Web        int       `json:"web"`
	Apps       int       `json:"apps"`
	VPN        int       `json:"vpn"`
	Threats    int       `json:"threats"`
	Devices    int       `json:"devices"`
	HighDLP    int       `json:"high_dlp"`
	LastSeen   time.Time `json:"last_incident"`
}

func (h *ReportHandler) topUsers(orgID string, w reportWindow, limit int) []userRisk {
	var rows []userRisk
	h.db.Raw(`SELECT e.id AS employee_id,
		TRIM(TRIM(COALESCE(e.first_name,'')) || ' ' || TRIM(COALESCE(e.last_name,''))) AS name,
		e.email, e.department,
		COUNT(*) AS incidents,
		COUNT(*) FILTER (WHERE `+controlSQL+` = 'dlp') AS dlp,
		COUNT(*) FILTER (WHERE `+controlSQL+` = 'web') AS web,
		COUNT(*) FILTER (WHERE `+controlSQL+` = 'apps') AS apps,
		COUNT(*) FILTER (WHERE `+controlSQL+` = 'vpn') AS vpn,
		COUNT(*) FILTER (WHERE `+controlSQL+` = 'threats') AS threats,
		COUNT(*) FILTER (WHERE `+controlSQL+` = 'devices') AS devices,
		COUNT(*) FILTER (WHERE ae.category = 'dlp' AND (ae.metadata->>'band' = 'block' OR ae.risk_score >= 80)) AS high_dlp,
		MAX(ae.timestamp) AS last_seen
		FROM activity_events ae
		JOIN employees e ON e.id = ae.employee_id
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ? AND `+incidentSQL+`
		GROUP BY e.id, e.first_name, e.last_name, e.email, e.department
		ORDER BY high_dlp DESC, incidents DESC LIMIT ?`,
		orgID, w.Start, w.End, limit).Scan(&rows)
	return rows
}

// sortedLabels turns a count map into a ranked list (ties broken by name).
func sortedLabels(m map[string]int) []labelCount {
	out := make([]labelCount, 0, len(m))
	for k, v := range m {
		out = append(out, labelCount{k, v})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Label < out[j].Label
	})
	return out
}
