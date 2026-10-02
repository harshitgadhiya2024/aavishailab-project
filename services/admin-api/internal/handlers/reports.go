package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // report periods are computed in the viewer's zone; the alpine image has no zoneinfo

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/models"
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
	// EmployeeID narrows a report to one person (?employee_id=), as a
	// parsed UUID string.
	EmployeeID   string
	EmployeeName string
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
	w := reportWindow{
		Start: start, End: end,
		PrevStart: start.Add(-span), PrevEnd: start,
		Loc:    loc,
		Hourly: span <= 48*time.Hour,
	}
	if id, err := uuid.Parse(c.Query("employee_id")); err == nil {
		// The filter applies even for an id from another org: that report is
		// then empty, never silently org-wide.
		w.EmployeeID = id.String()
		var e models.Employee
		if h.db.Select("first_name", "last_name", "email").First(&e, "id = ? AND org_id = ?", id, orgID).Error == nil {
			w.EmployeeName = strings.TrimSpace(strings.TrimSpace(e.FirstName) + " " + strings.TrimSpace(e.LastName))
			if w.EmployeeName == "" {
				w.EmployeeName = e.Email
			}
		}
	}
	return w
}

func (w reportWindow) meta() gin.H {
	bucket := "day"
	if w.Hourly {
		bucket = "hour"
	}
	m := gin.H{"start": w.Start, "end": w.End, "tz": w.Loc.String(), "bucket": bucket}
	if w.EmployeeID != "" {
		m["employee_id"], m["employee_name"] = w.EmployeeID, w.EmployeeName
	}
	return m
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

func validControl(id string) bool {
	for _, c := range controls {
		if c.ID == id {
			return true
		}
	}
	return false
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

func controlStats(d *reportData) ([]controlStat, int64, int64) {
	type counts struct{ n, blocked, alerted int64 }
	cur := map[string]*counts{}
	for _, e := range d.incidents(nil) {
		c := cur[e.Control]
		if c == nil {
			c = &counts{}
			cur[e.Control] = c
		}
		c.n++
		if e.Action == string(models.EventActionBlocked) {
			c.blocked++
		} else {
			c.alerted++
		}
	}
	out := make([]controlStat, 0, len(controls))
	var total, prevTotal int64
	for _, c := range controls {
		n := cur[c.ID]
		if n == nil {
			n = &counts{}
		}
		p := d.prev[c.ID]
		total += n.n
		prevTotal += p
		out = append(out, controlStat{
			ID: c.ID, Label: c.Label, Count: n.n, Blocked: n.blocked, Alerted: n.alerted,
			Prev: p, Delta: delta(n.n, p),
		})
	}
	return out, total, prevTotal
}

// trend returns one point per day (or hour) in the window, including empty
// ones, with a count per control. A chart that skips empty days draws a quiet
// weekend as a straight line between two busy weekdays.
func trend(d *reportData, w reportWindow, keep func(*reportEvent) bool) []map[string]any {
	layout := "2006-01-02"
	if w.Hourly {
		layout = "2006-01-02T15:00"
	}
	byKey := map[string]map[string]int{}
	for _, e := range d.incidents(keep) {
		k := e.At.In(w.Loc).Format(layout)
		if byKey[k] == nil {
			byKey[k] = map[string]int{}
		}
		byKey[k][e.Control]++
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
		p := map[string]any{"t": k}
		total := 0
		for _, c := range controls {
			n := byKey[k][c.ID]
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
	Devices       int64 `json:"devices"`
	Online        int64 `json:"online"`
	Stale         int64 `json:"stale"`
	PostureIssues int64 `json:"posture_issues"`
	// SettingsIssues names each laptop with a security setting switched off,
	// so the dashboard can say "Firewall is off on Utsavi's laptop" rather
	// than an abstract "1 failing".
	SettingsIssues        []settingIssue `json:"settings_issues"`
	Employees             int64          `json:"employees"`
	EmployeesWithoutAgent int64          `json:"employees_without_agent"`
	PendingRequests       int64          `json:"pending_requests"`
	Policies              int64          `json:"policies"`
	PoliciesEnabled       int64          `json:"policies_enabled"`
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
	r.SettingsIssues = h.settingIssues(orgID, 20)
	return r
}

// postureFailedSQL is the device's list of settings found switched off
// (guarded: metadata may hold a null or a non-array there).
const postureFailedSQL = `(CASE WHEN jsonb_typeof(d.metadata->'posture_failed') = 'array' THEN d.metadata->'posture_failed' ELSE '[]'::jsonb END)`

type settingIssue struct {
	Device   string   `json:"device"`
	Employee string   `json:"employee"`
	OS       string   `json:"os"`
	Off      []string `json:"off"` // human names of the settings that are off
	Fix      []string `json:"fix"` // one instruction per setting, for this OS
	Summary  string   `json:"summary"`
}

type settingText struct{ name, mac, windows, linux string }

// securitySettings describes each posture check the way an admin says it,
// with where to switch it on per operating system.
var securitySettings = map[string]settingText{
	"firewall":        {"Firewall", "System Settings > Network > Firewall, then turn it on", "Windows Security > Firewall & network protection, then turn it on", "Run: sudo ufw enable"},
	"disk_encryption": {"Disk encryption", "System Settings > Privacy & Security > FileVault, then Turn On", "Settings > Privacy & security > Device encryption (or BitLocker), then turn it on", "Encrypt the disk with LUKS (usually needs a reinstall)"},
	"os_up_to_date":   {"OS updates", "System Settings > General > Software Update, then install updates", "Settings > Windows Update, then install updates", "Install pending updates, e.g. sudo apt upgrade"},
	"screen_lock":     {"Screen lock", "System Settings > Lock Screen, then require a password after sleep", "Settings > Accounts > Sign-in options, then require sign-in after sleep", "Settings > Privacy > Screen Lock, then turn it on"},
	"antivirus":       {"Antivirus", "Install or re-enable the company's antivirus", "Windows Security > Virus & threat protection, then turn it on", "Install or re-enable the company's antivirus"},
}

func settingFor(key, osType string) (name, fix string) {
	t, ok := securitySettings[key]
	if !ok {
		n := strings.ReplaceAll(key, "_", " ")
		return strings.ToUpper(n[:1]) + n[1:], "Turn it back on"
	}
	switch strings.ToLower(osType) {
	case "windows":
		return t.name, t.windows
	case "linux":
		return t.name, t.linux
	default:
		return t.name, t.mac
	}
}

func joinNames(n []string) string {
	switch len(n) {
	case 0:
		return ""
	case 1:
		return n[0]
	default:
		return strings.Join(n[:len(n)-1], ", ") + " and " + n[len(n)-1]
	}
}

func (h *ReportHandler) settingIssues(orgID string, limit int) []settingIssue {
	var rows []struct {
		Hostname string
		Employee string
		OSType   string
		Failed   string
	}
	h.db.Raw(`SELECT d.hostname, TRIM(TRIM(COALESCE(e.first_name,'')) || ' ' || TRIM(COALESCE(e.last_name,''))) AS employee,
		COALESCE(d.os_type,'') AS os_type,
		(SELECT string_agg(f, ',') FROM jsonb_array_elements_text(`+postureFailedSQL+`) f) AS failed
		FROM devices d LEFT JOIN employees e ON e.id = d.employee_id
		WHERE d.org_id = ? AND d.deleted_at IS NULL AND jsonb_array_length(`+postureFailedSQL+`) > 0
		ORDER BY d.hostname LIMIT ?`, orgID, limit).Scan(&rows)

	out := make([]settingIssue, 0, len(rows))
	for _, r := range rows {
		is := settingIssue{Device: r.Hostname, Employee: r.Employee, OS: r.OSType}
		for _, k := range strings.Split(r.Failed, ",") {
			if k == "" {
				continue
			}
			name, fix := settingFor(k, r.OSType)
			is.Off = append(is.Off, name)
			is.Fix = append(is.Fix, name+": "+fix)
		}
		verb := "is"
		if len(is.Off) > 1 {
			verb = "are"
		}
		who := r.Hostname
		if r.Employee != "" {
			who = r.Employee + "'s laptop"
		}
		is.Summary = fmt.Sprintf("%s %s off on %s", joinNames(is.Off), verb, who)
		out = append(out, is)
	}
	return out
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
func attention(d *reportData, hl health, stats []controlStat) []attentionItem {
	items := []attentionItem{}
	if hl.Policies > 0 && hl.PoliciesEnabled == 0 {
		items = append(items, attentionItem{"high", "No policy is switched on", "Devices are enrolled but nothing is being enforced.", "/dashboard/swg"})
	}

	for i, is := range hl.SettingsIssues {
		if i == 3 {
			break
		}
		items = append(items, attentionItem{"high", is.Summary,
			is.Device + ". To fix: " + strings.Join(is.Fix, "; ") + ". The warning clears by itself once the laptop reports the setting is on.",
			"/dashboard/devices"})
	}
	if n := len(hl.SettingsIssues); n > 3 {
		items = append(items, attentionItem{"high", fmt.Sprintf("%d more laptops have a security setting turned off", n-3), "See the Device compliance report for the full list.", "/dashboard/reports?report=devices"})
	}

	var highDLP int64
	for i := range d.cur {
		if d.cur[i].highDLP() {
			highDLP++
		}
	}
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
	d, err := h.loadReport(c.Request.Context(), orgID, w)
	if err != nil {
		respondStoreError(c, err)
		return
	}

	stats, total, prevTotal := controlStats(d)
	hl := h.health(orgID)

	affected := employeeSet{}
	for _, e := range d.incidents(nil) {
		affected.add(e.Employee)
	}

	c.JSON(http.StatusOK, gin.H{
		"period":       w.meta(),
		"health":       hl,
		"attention":    attention(d, hl, stats),
		"controls":     stats,
		"totals":       gin.H{"incidents": total, "prev": prevTotal, "delta": delta(total, prevTotal), "affected_employees": len(affected)},
		"trend":        trend(d, w, nil),
		"top_apps":     topApps(d, 6),
		"top_sites":    topSites(d, 6),
		"dlp_services": dlpServices(d, 6),
		"dlp_types":    dlpTypes(d, 6),
		"top_users":    h.topUsers(d, 6),
		"truncated":    d.truncated,
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

func topApps(d *reportData, limit int) []appRow {
	type agg struct {
		row  appRow
		emps employeeSet
	}
	groups := map[string]*agg{}
	for _, e := range d.incidents(func(e *reportEvent) bool {
		return e.Category == "application_control" && e.Target != ""
	}) {
		k := e.Target + "\x00" + e.Control
		g := groups[k]
		if g == nil {
			g = &agg{row: appRow{Name: e.Target, Control: e.Control}, emps: employeeSet{}}
			groups[k] = g
		}
		g.row.Count++
		g.emps.add(e.Employee)
		if e.At.After(g.row.Last) {
			g.row.Last = e.At
		}
	}
	rows := make([]appRow, 0, len(groups))
	for _, g := range groups {
		g.row.Employees = len(g.emps)
		rows = append(rows, g.row)
	}
	sortByCountThenName(rows, func(r appRow) int { return r.Count }, func(r appRow) string { return r.Name })
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows
}

type siteRow struct {
	Domain    string    `json:"domain"`
	Category  string    `json:"category"`
	Count     int       `json:"count"`
	Employees int       `json:"employees"`
	Last      time.Time `json:"last"`
}

func topSites(d *reportData, limit int) []siteRow {
	type agg struct {
		row               siteRow
		emps              employeeSet
		maxPolicy, maxCat string
	}
	groups := map[string]*agg{}
	for _, e := range d.incidents(func(e *reportEvent) bool { return e.Control == "web" && e.Domain != "" }) {
		g := groups[e.Domain]
		if g == nil {
			g = &agg{row: siteRow{Domain: e.Domain}, emps: employeeSet{}}
			groups[e.Domain] = g
		}
		g.row.Count++
		g.emps.add(e.Employee)
		if e.At.After(g.row.Last) {
			g.row.Last = e.At
		}
		if e.Policy > g.maxPolicy {
			g.maxPolicy = e.Policy
		}
		if e.Category > g.maxCat {
			g.maxCat = e.Category
		}
	}
	rows := make([]siteRow, 0, len(groups))
	for _, g := range groups {
		g.row.Employees = len(g.emps)
		g.row.Category = siteCategory(g.maxPolicy, g.maxCat)
		rows = append(rows, g.row)
	}
	sortByCountThenName(rows, func(r siteRow) int { return r.Count }, func(r siteRow) string { return r.Domain })
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows
}

type serviceRow struct {
	Service string `json:"service"`
	Count   int    `json:"count"`
	High    int    `json:"high"`
}

func dlpServices(d *reportData, limit int) []serviceRow {
	groups := map[string]*serviceRow{}
	for i := range d.cur {
		e := &d.cur[i]
		if e.Category != "dlp" {
			continue
		}
		g := groups[e.Service]
		if g == nil {
			g = &serviceRow{Service: e.Service}
			groups[e.Service] = g
		}
		g.Count++
		if e.highDLP() {
			g.High++
		}
	}
	rows := make([]serviceRow, 0, len(groups))
	for _, g := range groups {
		rows = append(rows, *g)
	}
	sortByCountThenName(rows, func(r serviceRow) int { return r.Count }, func(r serviceRow) string { return r.Service })
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows
}

type labelCount struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

func dlpTypes(d *reportData, limit int) []labelCount {
	counts := map[string]int{}
	for i := range d.cur {
		if d.cur[i].Category == "dlp" {
			for _, det := range d.cur[i].Detectors {
				counts[det]++
			}
		}
	}
	rows := sortedLabels(counts)
	if len(rows) > limit {
		rows = rows[:limit]
	}
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

func (h *ReportHandler) topUsers(d *reportData, limit int) []userRisk {
	incidents := d.incidents(nil)
	people := peopleFor(h.db, incidents)
	byEmp := map[uuid.UUID]*userRisk{}
	for _, e := range incidents {
		if e.Employee == nil {
			continue
		}
		p, known := people[*e.Employee]
		if !known {
			continue // the employee was removed; the SQL JOIN dropped these too
		}
		u := byEmp[*e.Employee]
		if u == nil {
			u = &userRisk{EmployeeID: e.Employee.String(), Name: p.Name, Email: p.Email, Department: p.Department}
			byEmp[*e.Employee] = u
		}
		u.Incidents++
		switch e.Control {
		case "dlp":
			u.DLP++
		case "web":
			u.Web++
		case "apps":
			u.Apps++
		case "vpn":
			u.VPN++
		case "threats":
			u.Threats++
		case "devices":
			u.Devices++
		}
		if e.highDLP() {
			u.HighDLP++
		}
		if e.At.After(u.LastSeen) {
			u.LastSeen = e.At
		}
	}
	rows := make([]userRisk, 0, len(byEmp))
	for _, u := range byEmp {
		rows = append(rows, *u)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].HighDLP != rows[j].HighDLP {
			return rows[i].HighDLP > rows[j].HighDLP
		}
		if rows[i].Incidents != rows[j].Incidents {
			return rows[i].Incidents > rows[j].Incidents
		}
		return rows[i].Name < rows[j].Name
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
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
