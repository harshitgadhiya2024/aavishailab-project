package handlers

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── Catalog ──────────────────────────────────────────────────────────────────

type reportMeta struct {
	ID          string `json:"id"`
	Group       string `json:"group"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
}

// reportCatalog is the set of reports a company actually uses: one for
// management, one per control for the people running it, and the people,
// device and governance views an auditor asks for.
var reportCatalog = []reportMeta{
	{"executive", "Overview", "Executive summary", "Protection status, incidents by control and change vs the previous period. The one to send to management.", "layout-dashboard"},
	{"incidents", "Security", "All incidents", "Every blocked or flagged event, with employee, device, control and policy. Your audit log.", "shield"},
	{"dlp", "Security", "Data protection", "Sensitive data leaving the company: which service, what kind of data, how severe, and who.", "file-warning"},
	{"web", "Security", "Web filtering", "Blocked websites by domain and category, and who tried to reach them.", "globe"},
	{"apps", "Security", "Application control", "Blocked applications and VPN bypass attempts, by app and by employee.", "app-window"},
	{"employee-risk", "People & devices", "Employee risk", "Incidents per employee, broken down by control, ranked by severity.", "users"},
	{"employee-activity", "People & devices", "Employee activity", "Tracked and active hours, activity level and screenshots per employee.", "clock"},
	{"devices", "People & devices", "Device compliance", "Every device with agent status, last check-in and security settings that are turned off, plus employees with no device.", "monitor"},
	{"policies", "Governance", "Policy effectiveness", "Which policies fire and how often, so you can tune or retire them.", "file-text"},
	{"access-requests", "Governance", "Access requests", "Exception requests from employees and how they were decided.", "inbox"},
}

func reportName(id string) string {
	for _, r := range reportCatalog {
		if r.ID == id {
			return r.Name
		}
	}
	return id
}

// Catalog handles GET /reports/catalog
func (h *ReportHandler) Catalog(c *gin.Context) {
	ctrls := make([]control, len(controls))
	copy(ctrls, controls)
	c.JSON(http.StatusOK, gin.H{"reports": reportCatalog, "controls": ctrls})
}

// ─── Report shape ─────────────────────────────────────────────────────────────

type summaryItem struct {
	Label string `json:"label"`
	Value any    `json:"value"`
	Hint  string `json:"hint,omitempty"`
}

type reportChart struct {
	Type  string `json:"type"` // trend | bars
	Title string `json:"title"`
	Data  any    `json:"data"`
}

// reportTable is what every report returns, so one screen renderer and one
// exporter handle all of them.
type reportTable struct {
	Columns   []string      `json:"columns"`
	Rows      [][]any       `json:"rows"`
	Summary   []summaryItem `json:"summary"`
	Charts    []reportChart `json:"charts"`
	Truncated bool          `json:"truncated"`
}

const (
	viewRowLimit   = 5000
	exportRowLimit = 100000
)

// Report handles GET /reports/:type. ?format=csv|xlsx exports; ?control=
// narrows the incidents report to one control.
func (h *ReportHandler) Report(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	w := h.parseWindow(c, orgID)
	reportType := c.Param("type")
	format := strings.ToLower(c.Query("format"))

	limit := viewRowLimit
	if format == "csv" || format == "xlsx" {
		limit = exportRowLimit
	}

	var t reportTable
	switch reportType {
	case "executive":
		t = h.executiveReport(orgID, w)
	case "incidents":
		ctrl := c.Query("control")
		if !validControl(ctrl) {
			ctrl = ""
		}
		t = h.incidentsReport(orgID, w, ctrl, limit)
	case "dlp":
		t = h.dlpReport(orgID, w, limit)
	case "web":
		t = h.webReport(orgID, w, limit)
	case "apps":
		t = h.appsReport(orgID, w, limit)
	case "employee-risk":
		t = h.employeeRiskReport(orgID, w, limit)
	case "employee-activity":
		t = h.employeeActivityReport(orgID, w)
	case "devices":
		t = h.devicesReport(orgID, w)
	case "policies":
		t = h.policiesReport(orgID, w)
	case "access-requests":
		t = h.accessRequestsReport(orgID, w, limit)
	default:
		c.JSON(http.StatusNotFound, gin.H{"error": "Unknown report type"})
		return
	}
	if t.Rows == nil {
		t.Rows = [][]any{}
	}
	if t.Charts == nil {
		t.Charts = []reportChart{}
	}
	if t.Summary == nil {
		t.Summary = []summaryItem{}
	}
	t.Truncated = len(t.Rows) >= limit

	switch format {
	case "csv":
		h.writeCSV(c, reportType, w, t)
		return
	case "xlsx":
		h.writeXLSX(c, reportType, w, t)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"report":    reportType,
		"name":      reportName(reportType),
		"period":    w.meta(),
		"columns":   t.Columns,
		"rows":      t.Rows,
		"summary":   t.Summary,
		"charts":    t.Charts,
		"total":     len(t.Rows),
		"truncated": t.Truncated,
	})
}

// ─── Export ───────────────────────────────────────────────────────────────────

func exportFilename(reportType string, w reportWindow, ext string) string {
	end := w.End.Add(-time.Second) // end is exclusive; name the last day covered
	return fmt.Sprintf("delsecure_%s_%s_to_%s.%s", reportType,
		w.Start.In(w.Loc).Format("2006-01-02"), end.In(w.Loc).Format("2006-01-02"), ext)
}

func (w reportWindow) periodText() string {
	end := w.End.Add(-time.Second)
	return fmt.Sprintf("%s to %s (%s)", w.Start.In(w.Loc).Format("2 Jan 2006 15:04"), end.In(w.Loc).Format("2 Jan 2006 15:04"), w.Loc.String())
}

// preamble is what an exported file says about itself, so a copy that lands
// in an audit folder explains what it covers without the email it came in.
func (w reportWindow) preamble(reportType string, t reportTable) [][]string {
	rows := [][]string{
		{"DelSecure report", reportName(reportType)},
		{"Period", w.periodText()},
		{"Generated", time.Now().In(w.Loc).Format("2 Jan 2006 15:04")},
	}
	for _, s := range t.Summary {
		rows = append(rows, []string{s.Label, fmt.Sprintf("%v", s.Value)})
	}
	if t.Truncated {
		rows = append(rows, []string{"Note", fmt.Sprintf("Only the most recent %d rows are included. Choose a shorter period for the rest.", len(t.Rows))})
	}
	return rows
}

func cellString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case time.Time:
		return x.Format("2006-01-02 15:04")
	case *float64:
		if x == nil {
			return ""
		}
		return fmt.Sprintf("%.1f", *x)
	default:
		return fmt.Sprintf("%v", x)
	}
}

func (h *ReportHandler) writeCSV(c *gin.Context, reportType string, w reportWindow, t reportTable) {
	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF") // BOM: Excel otherwise opens UTF-8 names as mojibake
	cw := csv.NewWriter(&buf)
	for _, r := range w.preamble(reportType, t) {
		_ = cw.Write(r)
	}
	_ = cw.Write([]string{})
	_ = cw.Write(t.Columns)
	for _, row := range t.Rows {
		rec := make([]string, len(row))
		for i, v := range row {
			rec[i] = csvSafe(cellString(v))
		}
		_ = cw.Write(rec)
	}
	cw.Flush()
	c.Header("Content-Disposition", `attachment; filename="`+exportFilename(reportType, w, "csv")+`"`)
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}

// csvSafe defuses spreadsheet formula injection: a file name like
// "=HYPERLINK(...)" captured from an employee's upload must not execute when
// an admin opens the export.
func csvSafe(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

func (h *ReportHandler) writeXLSX(c *gin.Context, reportType string, w reportWindow, t reportTable) {
	summary := xlsxSheet{Name: "Summary", Widths: []float64{28, 70}}
	for i, r := range w.preamble(reportType, t) {
		cells := make([]any, len(r))
		for j, v := range r {
			cells[j] = v
		}
		summary.Rows = append(summary.Rows, cells)
		if i == 0 {
			summary.BoldRows = append(summary.BoldRows, 0)
		}
	}

	data := xlsxSheet{Name: "Data", Header: true}
	head := make([]any, len(t.Columns))
	widths := make([]float64, len(t.Columns))
	for i, col := range t.Columns {
		head[i] = col
		widths[i] = float64(len(col)) + 4
	}
	data.Rows = append(data.Rows, head)
	for _, row := range t.Rows {
		cells := make([]any, len(row))
		for i, v := range row {
			switch x := v.(type) {
			case int, int64, float64:
				cells[i] = x
			default:
				s := cellString(v)
				cells[i] = s
				if i < len(widths) && float64(len(s))+2 > widths[i] {
					widths[i] = float64(len(s)) + 2
				}
			}
		}
		data.Rows = append(data.Rows, cells)
	}
	for i := range widths {
		if widths[i] > 60 {
			widths[i] = 60
		}
	}
	data.Widths = widths

	var buf bytes.Buffer
	if err := writeXLSX(&buf, []xlsxSheet{summary, data}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build spreadsheet"})
		return
	}
	c.Header("Content-Disposition", `attachment; filename="`+exportFilename(reportType, w, "xlsx")+`"`)
	c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf.Bytes())
}

// ─── Reports ──────────────────────────────────────────────────────────────────

func fmtDelta(d *float64) string {
	if d == nil {
		return "no earlier data"
	}
	if *d > 0 {
		return fmt.Sprintf("+%.1f%%", *d)
	}
	return fmt.Sprintf("%.1f%%", *d)
}

func (h *ReportHandler) executiveReport(orgID string, w reportWindow) reportTable {
	stats, total, prevTotal := h.controlStats(orgID, w)
	hl := h.health(orgID)

	rows := [][]any{}
	for _, s := range stats {
		rows = append(rows, []any{"Incidents", s.Label, s.Count, s.Prev, fmtDelta(s.Delta)})
	}
	rows = append(rows, []any{"Incidents", "Total", total, prevTotal, fmtDelta(delta(total, prevTotal))})
	coverage := "—"
	if hl.Employees > 0 {
		coverage = fmt.Sprintf("%d%%", (hl.Employees-hl.EmployeesWithoutAgent)*100/hl.Employees)
	}
	rows = append(rows,
		[]any{"Protection", "Devices enrolled", hl.Devices, "", ""},
		[]any{"Protection", "Devices online now", hl.Online, "", ""},
		[]any{"Protection", "Devices not seen for 7+ days", hl.Stale, "", ""},
		[]any{"Protection", "Laptops with a security setting turned off", hl.PostureIssues, "", ""},
		[]any{"Protection", "Employees without a protected device", hl.EmployeesWithoutAgent, "", ""},
		[]any{"Protection", "Employee coverage", coverage, "", ""},
		[]any{"Governance", "Policies enabled", fmt.Sprintf("%d of %d", hl.PoliciesEnabled, hl.Policies), "", ""},
		[]any{"Governance", "Access requests waiting", hl.PendingRequests, "", ""},
	)

	top := h.topUsers(orgID, w, 5)
	users := make([]labelCount, 0, len(top))
	for _, u := range top {
		name := u.Name
		if strings.TrimSpace(name) == "" {
			name = u.Email
		}
		users = append(users, labelCount{name, u.Incidents})
	}

	return reportTable{
		Columns: []string{"Area", "Measure", "This period", "Previous period", "Change"},
		Rows:    rows,
		Summary: []summaryItem{
			{"Incidents", total, fmtDelta(delta(total, prevTotal)) + " vs previous period"},
			{"Devices protected", fmt.Sprintf("%d of %d online", hl.Online, hl.Devices), ""},
			{"Employee coverage", coverage, ""},
			{"Needs attention", len(h.attention(orgID, w, hl, stats)), "open items"},
		},
		Charts: []reportChart{
			{"trend", "Incidents over time, by control", h.trend(orgID, w, "")},
			{"bars", "Employees with the most incidents", users},
		},
	}
}

// incidentRows lists incidents newest first. where narrows it (with args).
func (h *ReportHandler) incidentRows(orgID string, w reportWindow, where string, limit int, args ...any) []struct {
	Timestamp time.Time
	Name      string
	Email     string
	Hostname  string
	Control   string
	Target    string
	Domain    string
	Operation string
	Action    string
	Policy    string
	Risk      float64
	Service   string
	Band      string
	Detectors string
	Kind      string
} {
	var rows []struct {
		Timestamp time.Time
		Name      string
		Email     string
		Hostname  string
		Control   string
		Target    string
		Domain    string
		Operation string
		Action    string
		Policy    string
		Risk      float64
		Service   string
		Band      string
		Detectors string
		Kind      string
	}
	q := `SELECT ae.timestamp,
		TRIM(TRIM(COALESCE(e.first_name,'')) || ' ' || TRIM(COALESCE(e.last_name,''))) AS name,
		COALESCE(e.email,'') AS email, COALESCE(d.hostname,'') AS hostname,
		` + controlSQL + ` AS control,
		COALESCE(ae.target,'') AS target, COALESCE(ae.target_domain,'') AS domain,
		COALESCE(ae.operation,'') AS operation, ae.action::text AS action,
		COALESCE(ae.policy_name,'') AS policy, COALESCE(ae.risk_score,0) AS risk,
		` + dlpServiceSQL + ` AS service,
		COALESCE(ae.metadata->>'band','') AS band,
		COALESCE((SELECT string_agg(x, ',') FROM jsonb_array_elements_text(
			CASE WHEN jsonb_typeof(ae.metadata->'detectors') = 'array' THEN ae.metadata->'detectors' ELSE '[]'::jsonb END) x), '') AS detectors,
		COALESCE(ae.metadata->>'content_kind','') AS kind
		FROM activity_events ae
		LEFT JOIN employees e ON e.id = ae.employee_id
		LEFT JOIN devices d ON d.id = ae.device_id
		WHERE ae.org_id = ? AND ae.timestamp >= ? AND ae.timestamp < ? AND ` + incidentSQL
	params := []any{orgID, w.Start, w.End}
	if where != "" {
		q += " AND " + where
		params = append(params, args...)
	}
	params = append(params, limit)
	h.db.Raw(q+" ORDER BY ae.timestamp DESC LIMIT ?", params...).Scan(&rows)
	for i := range rows {
		if rows[i].Detectors == "" {
			continue
		}
		ids := strings.Split(rows[i].Detectors, ",")
		for j, id := range ids {
			ids[j] = detectorLabel(id)
		}
		rows[i].Detectors = strings.Join(ids, ", ")
	}
	return rows
}

func actionLabel(a string) string {
	switch a {
	case "blocked":
		return "Blocked"
	case "alerted":
		return "Flagged"
	}
	return a
}

func (h *ReportHandler) incidentsReport(orgID string, w reportWindow, ctrl string, limit int) reportTable {
	where, args := "", []any{}
	if ctrl != "" {
		where, args = controlSQL+" = ?", []any{ctrl}
	}
	rows := h.incidentRows(orgID, w, where, limit, args...)
	out := make([][]any, 0, len(rows))
	byControl := map[string]int{}
	blocked := 0
	for _, r := range rows {
		what := r.Target
		if r.Domain != "" && r.Control != "apps" && r.Control != "vpn" {
			what = r.Domain
		}
		out = append(out, []any{
			w.fmtTime(r.Timestamp), r.Name, r.Email, r.Hostname, controlLabel(r.Control),
			actionLabel(r.Action), what, r.Operation, r.Policy, int(r.Risk),
		})
		byControl[controlLabel(r.Control)]++
		if r.Action == "blocked" {
			blocked++
		}
	}
	return reportTable{
		Columns: []string{"Time", "Employee", "Email", "Device", "Control", "Outcome", "What", "Activity", "Policy", "Risk"},
		Rows:    out,
		Summary: []summaryItem{
			{"Incidents", len(out), ""},
			{"Blocked", blocked, ""},
			{"Flagged", len(out) - blocked, ""},
		},
		Charts: []reportChart{
			{"trend", "Incidents over time", h.trend(orgID, w, where, args...)},
			{"bars", "Incidents by control", sortedLabels(byControl)},
		},
	}
}

func (h *ReportHandler) dlpReport(orgID string, w reportWindow, limit int) reportTable {
	rows := h.incidentRows(orgID, w, "ae.category = 'dlp'", limit)
	out := make([][]any, 0, len(rows))
	high, people := 0, map[string]bool{}
	for _, r := range rows {
		sev := "Medium"
		if r.Band == "block" || r.Risk >= 80 {
			sev = "High"
			high++
		}
		kind := strings.ReplaceAll(r.Kind, "-", " ")
		out = append(out, []any{
			w.fmtTime(r.Timestamp), r.Name, r.Email, r.Service, r.Domain, sev, r.Detectors, kind, r.Policy, int(r.Risk),
		})
		if r.Email != "" {
			people[r.Email] = true
		}
	}
	services := h.dlpServices(orgID, w, 10)
	svc := make([]labelCount, 0, len(services))
	for _, s := range services {
		svc = append(svc, labelCount{s.Service, s.Count})
	}
	return reportTable{
		Columns: []string{"Time", "Employee", "Email", "Sent to", "Site", "Severity", "Data found", "Content", "Policy", "Score"},
		Rows:    out,
		Summary: []summaryItem{
			{"Sensitive data incidents", len(out), ""},
			{"High severity", high, "would be blocked under a blocking policy"},
			{"Employees involved", len(people), ""},
		},
		Charts: []reportChart{
			{"bars", "Where sensitive data went", svc},
			{"bars", "What kind of data", h.dlpTypes(orgID, w, 10)},
		},
	}
}

func (h *ReportHandler) webReport(orgID string, w reportWindow, limit int) reportTable {
	sites := h.topSites(orgID, w, limit)
	out := make([][]any, 0, len(sites))
	cats := map[string]int{}
	total := 0
	for _, s := range sites {
		out = append(out, []any{s.Domain, s.Category, s.Count, s.Employees, w.fmtTime(s.Last)})
		cats[s.Category] += s.Count
		total += s.Count
	}
	top := sites
	if len(top) > 10 {
		top = top[:10]
	}
	bars := make([]labelCount, 0, len(top))
	for _, s := range top {
		bars = append(bars, labelCount{s.Domain, s.Count})
	}
	return reportTable{
		Columns: []string{"Website", "Blocked by", "Attempts", "Employees", "Last attempt"},
		Rows:    out,
		Summary: []summaryItem{
			{"Blocked attempts", total, ""},
			{"Websites", len(out), ""},
			{"Categories", len(cats), ""},
		},
		Charts: []reportChart{
			{"bars", "Most-blocked websites", bars},
			{"bars", "Blocks by category", sortedLabels(cats)},
		},
	}
}

func (h *ReportHandler) appsReport(orgID string, w reportWindow, limit int) reportTable {
	apps := h.topApps(orgID, w, limit)
	out := make([][]any, 0, len(apps))
	total, vpn := 0, 0
	bars := []labelCount{}
	for _, a := range apps {
		out = append(out, []any{a.Name, controlLabel(a.Control), a.Count, a.Employees, w.fmtTime(a.Last)})
		total += a.Count
		if a.Control == "vpn" {
			vpn += a.Count
		}
		if len(bars) < 10 {
			bars = append(bars, labelCount{a.Name, a.Count})
		}
	}
	return reportTable{
		Columns: []string{"Application", "Control", "Attempts", "Employees", "Last attempt"},
		Rows:    out,
		Summary: []summaryItem{
			{"Blocked or flagged launches", total, ""},
			{"VPN bypass attempts", vpn, ""},
			{"Applications", len(out), ""},
		},
		Charts: []reportChart{
			{"trend", "Attempts over time", h.trend(orgID, w, controlSQL+" IN ('apps','vpn')")},
			{"bars", "Most-blocked applications", bars},
		},
	}
}

func (h *ReportHandler) employeeRiskReport(orgID string, w reportWindow, limit int) reportTable {
	users := h.topUsers(orgID, w, limit)
	out := make([][]any, 0, len(users))
	bars := []labelCount{}
	for _, u := range users {
		name := u.Name
		if strings.TrimSpace(name) == "" {
			name = u.Email
		}
		out = append(out, []any{name, u.Email, u.Department, u.Incidents, u.HighDLP, u.DLP, u.Web, u.Apps, u.VPN, u.Threats, u.Devices, w.fmtTime(u.LastSeen)})
		if len(bars) < 10 {
			bars = append(bars, labelCount{name, u.Incidents})
		}
	}
	var employees int64
	h.db.Raw(`SELECT COUNT(*) FROM employees WHERE org_id = ? AND deleted_at IS NULL`, orgID).Scan(&employees)
	return reportTable{
		Columns: []string{"Employee", "Email", "Department", "Incidents", "High-severity data", "Data protection", "Web", "Apps", "VPN", "Threats", "Device health", "Last incident"},
		Rows:    out,
		Summary: []summaryItem{
			{"Employees with incidents", len(out), fmt.Sprintf("of %d employees", employees)},
		},
		Charts: []reportChart{{"bars", "Employees with the most incidents", bars}},
	}
}

func fmtDuration(seconds int64) string {
	if seconds <= 0 {
		return "0m"
	}
	h, m := seconds/3600, (seconds%3600)/60
	if h == 0 {
		return fmt.Sprintf("%dm", m)
	}
	return fmt.Sprintf("%dh %02dm", h, m)
}

func (h *ReportHandler) employeeActivityReport(orgID string, w reportWindow) reportTable {
	var rows []struct {
		Name        string
		Email       string
		Department  string
		Sessions    int
		Tracked     int64
		Active      int64
		AvgActivity float64
		Screenshots int
		Days        int
		First       time.Time
		Last        time.Time
	}
	h.db.Raw(`SELECT TRIM(TRIM(COALESCE(e.first_name,'')) || ' ' || TRIM(COALESCE(e.last_name,''))) AS name,
		e.email, e.department,
		COUNT(ws.id) AS sessions,
		COALESCE(SUM(ws.tracked_seconds),0) AS tracked,
		COALESCE(SUM(ws.active_seconds),0) AS active,
		COALESCE(AVG(NULLIF(ws.avg_activity,0)),0) AS avg_activity,
		COALESCE(SUM(ws.screenshot_count),0) AS screenshots,
		COUNT(DISTINCT DATE(ws.started_at AT TIME ZONE ?)) AS days,
		MIN(ws.started_at) AS first, MAX(COALESCE(ws.ended_at, ws.started_at)) AS last
		FROM work_sessions ws JOIN employees e ON e.id = ws.employee_id
		WHERE ws.org_id = ? AND ws.started_at >= ? AND ws.started_at < ? AND ws.deleted_at IS NULL
		GROUP BY e.id, e.first_name, e.last_name, e.email, e.department
		ORDER BY tracked DESC`, w.Loc.String(), orgID, w.Start, w.End).Scan(&rows)

	out := make([][]any, 0, len(rows))
	bars := []labelCount{}
	var tracked, active int64
	for _, r := range rows {
		name := r.Name
		if strings.TrimSpace(name) == "" {
			name = r.Email
		}
		activePct := "—"
		if r.Tracked > 0 {
			activePct = fmt.Sprintf("%d%%", r.Active*100/r.Tracked)
		}
		perDay := "—"
		if r.Days > 0 {
			perDay = fmtDuration(r.Tracked / int64(r.Days))
		}
		out = append(out, []any{name, r.Email, r.Department, r.Days, fmtDuration(r.Tracked), fmtDuration(r.Active), activePct, perDay, r.Screenshots, w.fmtTime(r.First), w.fmtTime(r.Last)})
		tracked += r.Tracked
		active += r.Active
		if len(bars) < 10 {
			bars = append(bars, labelCount{name, int(r.Tracked / 3600)})
		}
	}
	activeShare := "—"
	if tracked > 0 {
		activeShare = fmt.Sprintf("%d%%", active*100/tracked)
	}
	return reportTable{
		Columns: []string{"Employee", "Email", "Department", "Days worked", "Tracked time", "Active time", "Active %", "Avg per day", "Screenshots", "First session", "Last session"},
		Rows:    out,
		Summary: []summaryItem{
			{"Employees tracked", len(out), ""},
			{"Total tracked time", fmtDuration(tracked), ""},
			{"Active share", activeShare, "of tracked time"},
		},
		Charts: []reportChart{{"bars", "Tracked hours by employee", bars}},
	}
}

func (h *ReportHandler) devicesReport(orgID string, w reportWindow) reportTable {
	var rows []struct {
		Hostname     string
		Name         string
		Email        string
		OSType       string
		OSVersion    string
		AgentVersion string
		Status       string
		PostureScore int
		Failed       string
		LastSeenAt   *time.Time
		EnrolledAt   time.Time
	}
	h.db.Raw(`SELECT d.hostname,
		TRIM(TRIM(COALESCE(e.first_name,'')) || ' ' || TRIM(COALESCE(e.last_name,''))) AS name, COALESCE(e.email,'') AS email,
		d.os_type, d.os_version, d.agent_version, d.status, d.posture_score,
		COALESCE((SELECT string_agg(f, ',') FROM jsonb_array_elements_text(`+postureFailedSQL+`) f), '') AS failed,
		d.last_seen_at, d.enrolled_at
		FROM devices d LEFT JOIN employees e ON e.id = d.employee_id
		WHERE d.org_id = ? AND d.deleted_at IS NULL
		ORDER BY d.last_seen_at ASC NULLS FIRST`, orgID).Scan(&rows)

	staleBefore := time.Now().Add(-staleAfter)
	out := make([][]any, 0, len(rows))
	stale, failing := 0, 0
	for _, r := range rows {
		state := "Healthy"
		lastSeen := "never"
		if r.LastSeenAt != nil {
			lastSeen = w.fmtTime(*r.LastSeenAt)
		}
		switch {
		case r.LastSeenAt == nil || r.LastSeenAt.Before(staleBefore):
			state = "Not checking in"
			stale++
		case r.Failed != "":
			state = "Needs a fix"
			failing++
		}
		if r.Failed != "" {
			names := []string{}
			for _, k := range strings.Split(r.Failed, ",") {
				n, _ := settingFor(k, r.OSType)
				names = append(names, n)
			}
			r.Failed = strings.Join(names, ", ") + " off"
		}
		out = append(out, []any{r.Hostname, r.Name, r.Email, state, r.Failed, r.PostureScore, r.OSType + " " + r.OSVersion, r.AgentVersion, r.Status, lastSeen, w.fmtTime(r.EnrolledAt)})
	}

	// Employees with no device are the real coverage gap and are invisible in
	// a device list, so they are listed as rows of their own.
	var missing []struct{ Name, Email string }
	h.db.Raw(`SELECT TRIM(TRIM(COALESCE(e.first_name,'')) || ' ' || TRIM(COALESCE(e.last_name,''))) AS name, e.email
		FROM employees e WHERE e.org_id = ? AND e.deleted_at IS NULL AND NOT EXISTS (
		SELECT 1 FROM devices d WHERE d.employee_id = e.id AND d.deleted_at IS NULL) ORDER BY name`, orgID).Scan(&missing)
	for _, m := range missing {
		out = append(out, []any{"—", m.Name, m.Email, "No device enrolled", "", "", "", "", "", "", ""})
	}

	return reportTable{
		Columns: []string{"Device", "Employee", "Email", "State", "Settings turned off", "Security score", "OS", "Agent version", "Status", "Last check-in", "Enrolled"},
		Rows:    out,
		Summary: []summaryItem{
			{"Devices", len(rows), ""},
			{"Security setting turned off", failing, "firewall, encryption, updates, screen lock or antivirus"},
			{"Not checking in (7+ days)", stale, ""},
			{"Employees without a device", len(missing), ""},
		},
	}
}

func (h *ReportHandler) policiesReport(orgID string, w reportWindow) reportTable {
	// Most events carry only the policy's name (policy_id is often unset by the
	// agent), so hits are matched on id first and name second.
	var rows []struct {
		Name     string
		Type     string
		Action   string
		Priority int
		Enabled  bool
		Hits     int
		Users    int
		Last     *time.Time
	}
	h.db.Raw(`SELECT p.name, p.type::text AS type, p.action::text AS action, p.priority, p.enabled,
		COUNT(ae.id) AS hits, COUNT(DISTINCT ae.employee_id) AS users, MAX(ae.timestamp) AS last
		FROM policies p
		LEFT JOIN activity_events ae ON ae.org_id = p.org_id
		  AND ae.timestamp >= ? AND ae.timestamp < ? AND ae.action IN ('blocked','alerted')
		  AND (ae.policy_id = p.id OR (ae.policy_id IS NULL AND (ae.policy_name = p.name OR ae.policy_name = 'Policy: ' || p.name)))
		WHERE p.org_id = ? AND p.deleted_at IS NULL
		GROUP BY p.id, p.name, p.type, p.action, p.priority, p.enabled
		ORDER BY hits DESC, p.priority ASC`, w.Start, w.End, orgID).Scan(&rows)

	out := make([][]any, 0, len(rows))
	silent := 0
	bars := []labelCount{}
	for _, r := range rows {
		state := "On"
		if !r.Enabled {
			state = "Off"
		}
		last := "—"
		if r.Last != nil {
			last = w.fmtTime(*r.Last)
		}
		if r.Enabled && r.Hits == 0 {
			silent++
		}
		out = append(out, []any{r.Name, r.Type, r.Action, state, r.Hits, r.Users, last})
		if r.Hits > 0 && len(bars) < 10 {
			bars = append(bars, labelCount{r.Name, r.Hits})
		}
	}
	return reportTable{
		Columns: []string{"Policy", "Type", "Action", "State", "Times triggered", "Employees affected", "Last triggered"},
		Rows:    out,
		Summary: []summaryItem{
			{"Policies", len(out), ""},
			{"Switched on but never triggered", silent, "candidates to review"},
		},
		Charts: []reportChart{{"bars", "Most-triggered policies", bars}},
	}
}

func (h *ReportHandler) accessRequestsReport(orgID string, w reportWindow, limit int) reportTable {
	var rows []struct {
		CreatedAt  time.Time
		Name       string
		Email      string
		Domain     string
		Reason     string
		Status     string
		ReviewedAt *time.Time
	}
	h.db.Raw(`SELECT ar.created_at,
		TRIM(TRIM(COALESCE(e.first_name,'')) || ' ' || TRIM(COALESCE(e.last_name,''))) AS name,
		COALESCE(e.email,'') AS email, ar.domain, ar.reason, ar.status::text AS status, ar.reviewed_at
		FROM access_requests ar LEFT JOIN employees e ON e.id = ar.employee_id
		WHERE ar.org_id = ? AND ar.created_at >= ? AND ar.created_at < ?
		ORDER BY ar.created_at DESC LIMIT ?`, orgID, w.Start, w.End, limit).Scan(&rows)

	out := make([][]any, 0, len(rows))
	byStatus := map[string]int{}
	var waitTotal time.Duration
	decided := 0
	for _, r := range rows {
		reviewed, wait := "—", "—"
		if r.ReviewedAt != nil {
			reviewed = w.fmtTime(*r.ReviewedAt)
			d := r.ReviewedAt.Sub(r.CreatedAt)
			wait = fmtDuration(int64(d.Seconds()))
			waitTotal += d
			decided++
		}
		out = append(out, []any{w.fmtTime(r.CreatedAt), r.Name, r.Email, r.Domain, r.Reason, r.Status, reviewed, wait})
		byStatus[r.Status]++
	}
	avgWait := "—"
	if decided > 0 {
		avgWait = fmtDuration(int64(waitTotal.Seconds()) / int64(decided))
	}
	return reportTable{
		Columns: []string{"Requested", "Employee", "Email", "Website", "Reason", "Status", "Decided", "Waited"},
		Rows:    out,
		Summary: []summaryItem{
			{"Requests", len(out), ""},
			{"Approved", byStatus["approved"], ""},
			{"Denied", byStatus["denied"], ""},
			{"Average time to decide", avgWait, ""},
		},
		Charts: []reportChart{{"bars", "Requests by outcome", sortedLabels(byStatus)}},
	}
}
