package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Overview handles GET /api/v1/portal/overview?start=&end=&tz= (or ?days=) —
// everything the employee's own dashboard shows, in one round trip.
//
// It answers the questions an employee actually has: am I protected, did
// anything get blocked or flagged and why, is something on my laptop that I
// should fix, what's happening with my access requests, and — when the company
// monitors work time — what does it see. Figures come from the same report
// engine as the company dashboard (controls, trend, top sites and apps), so the
// two never disagree about the same events.
//
// Scope is fixed by the portal token: the employee and organization come only
// from the signed session, never from a query parameter, so nobody can read a
// colleague's dashboard by changing a URL. Employee data is read through the
// data plane, so it works the same for companies that keep it in their own
// database.
func (h *PortalHandler) Overview(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}
	// The access token lives for hours; an employee deactivated in the meantime
	// must stop seeing data straight away, not when it expires.
	if emp.Status != "" && emp.Status != "active" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Your account is not active. Contact your IT administrator."})
		return
	}
	// Personal data: never cached by a browser, proxy or CDN.
	c.Header("Cache-Control", "no-store")

	ctx := c.Request.Context()
	orgID := emp.OrgID.String()
	rh := &ReportHandler{db: h.db}
	w := rh.parseWindow(c, orgID)
	// Pin the window to the signed-in employee, whatever the query said.
	w.EmployeeID = emp.ID.String()
	w.EmployeeName = strings.TrimSpace(emp.FirstName + " " + emp.LastName)

	d, err := rh.loadReport(ctx, orgID, w)
	if err != nil {
		respondStoreError(c, err)
		return
	}

	stats, total, prevTotal := controlStats(d)
	var blocked, flagged int64
	for _, s := range stats {
		blocked += s.Blocked
		flagged += s.Alerted
	}

	devices := h.overviewDevices(emp, time.Now())
	work, err := h.overviewWork(c, emp, w)
	if err != nil {
		respondStoreError(c, err)
		return
	}
	requests, requestedSites := h.overviewRequests(emp, w)

	sites := topSites(d, 5)
	siteRows := make([]gin.H, 0, len(sites))
	for _, s := range sites {
		siteRows = append(siteRows, gin.H{
			"domain": s.Domain, "category": s.Category, "count": s.Count, "last": s.Last,
			"request_status": requestedSites[strings.ToLower(s.Domain)],
		})
	}

	var sensitive, sensitiveHigh int
	for i := range d.cur {
		if d.cur[i].Category == "dlp" {
			sensitive++
			if d.cur[i].highDLP() {
				sensitiveHigh++
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"period": w.meta(),
		"employee": gin.H{
			"first_name": emp.FirstName, "full_name": emp.FullName(),
			"department": emp.Department, "job_title": emp.JobTitle,
			"team": teamName(emp),
		},
		"protection": protectionSummary(devices),
		"devices":    devices,
		"totals": gin.H{
			"incidents": total, "prev": prevTotal, "delta": delta(total, prevTotal),
			"blocked": blocked, "flagged": flagged,
		},
		"controls":  stats,
		"trend":     trend(d, w, nil),
		"top_sites": siteRows,
		"top_apps":  topApps(d, 5),
		"sensitive_data": gin.H{
			"count": sensitive, "high": sensitiveHigh,
			"services": dlpServices(d, 5), "types": dlpTypes(d, 5),
		},
		"work":            work,
		"access_requests": requests,
		"recent":          recentIncidents(d, w, 6),
		"tips":            employeeTips(devices, stats, sensitiveHigh, requests, siteRows),
		"truncated":       d.truncated,
	})
}

func teamName(emp *models.Employee) string {
	if emp.Team != nil {
		return emp.Team.Name
	}
	return ""
}

// ─── Devices ──────────────────────────────────────────────────────────────────

type overviewDevice struct {
	ID              uuid.UUID       `json:"id"`
	Hostname        string          `json:"hostname"`
	OS              string          `json:"os"`
	AgentVersion    string          `json:"agent_version"`
	LatestVersion   string          `json:"latest_version,omitempty"`
	UpdateAvailable bool            `json:"update_available"`
	Status          string          `json:"status"`
	LastSeenAt      *time.Time      `json:"last_seen_at"`
	Stale           bool            `json:"stale"`
	Ownership       string          `json:"ownership"`
	SecurityScore   int             `json:"security_score"`
	Issues          []overviewIssue `json:"issues"`
	Enforcement     gin.H           `json:"enforcement"`
}

type overviewIssue struct {
	Name string `json:"name"`
	Fix  string `json:"fix"`
}

func (h *PortalHandler) overviewDevices(emp *models.Employee, now time.Time) []overviewDevice {
	var devices []models.Device
	h.db.Where("employee_id = ? AND org_id = ?", emp.ID, emp.OrgID).Order("last_seen_at DESC NULLS LAST").Find(&devices)

	latest := ""
	if m, err := readManifest(); err == nil {
		latest = m.Version
	}
	out := make([]overviewDevice, 0, len(devices))
	for i := range devices {
		dv := &devices[i]
		od := overviewDevice{
			ID: dv.ID, Hostname: dv.Hostname,
			OS:           strings.TrimSpace(dv.OSType + " " + dv.OSVersion),
			AgentVersion: dv.AgentVersion, Status: dv.Status, LastSeenAt: dv.LastSeenAt,
			Ownership: dv.Ownership, SecurityScore: dv.PostureScore, Issues: []overviewIssue{},
		}
		if od.Ownership == "" {
			od.Ownership = models.OwnershipCompany
		}
		od.Stale = dv.LastSeenAt == nil || now.Sub(*dv.LastSeenAt) > staleAfter
		if latest != "" && dv.AgentVersion != "" && versionLess(dv.AgentVersion, latest) {
			od.LatestVersion, od.UpdateAvailable = latest, true
		}
		if list, ok := dv.Metadata["posture_failed"].([]any); ok {
			for _, k := range list {
				if key, ok := k.(string); ok && key != "" {
					name, fix := settingFor(key, dv.OSType)
					od.Issues = append(od.Issues, overviewIssue{Name: name, Fix: fix})
				}
			}
		}
		st := deviceEnforcement(h.db, emp.OrgID, &dv.ID, teamIDForDevice(h.db, dv), now)
		od.Enforcement = gin.H{"active": st.Active, "mode": st.Mode, "reason": st.Reason, "until": st.Until}
		out = append(out, od)
	}
	return out
}

// versionLess reports a < b for dotted numeric versions ("2.9.0" < "2.9.1").
// Anything unparseable compares as equal, so a malformed version never claims
// an update is due.
func versionLess(a, b string) bool {
	pa := strings.Split(strings.TrimPrefix(a, "v"), ".")
	pb := strings.Split(strings.TrimPrefix(b, "v"), ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		var err error
		if i < len(pa) {
			if x, err = strconv.Atoi(strings.SplitN(pa[i], "-", 2)[0]); err != nil {
				return false
			}
		}
		if i < len(pb) {
			if y, err = strconv.Atoi(strings.SplitN(pb[i], "-", 2)[0]); err != nil {
				return false
			}
		}
		if x != y {
			return x < y
		}
	}
	return false
}

// protectionSummary is the one-line answer to "am I protected?".
func protectionSummary(devices []overviewDevice) gin.H {
	online, issues, stale, updates, paused := 0, 0, 0, 0, 0
	for _, d := range devices {
		if d.Status == "online" {
			online++
		}
		issues += len(d.Issues)
		if d.Stale {
			stale++
		}
		if d.UpdateAvailable {
			updates++
		}
		if active, _ := d.Enforcement["active"].(bool); !active {
			paused++
		}
	}
	status, headline := "protected", "Your devices are protected"
	switch {
	case len(devices) == 0:
		status, headline = "unprotected", "No device is protected yet — install the Aavishield agent"
	case stale == len(devices):
		status, headline = "unprotected", "Your devices haven't checked in for over a week"
	case issues > 0:
		status, headline = "attention", plural(int64(issues), "security setting needs", "security settings need")+" your attention"
	case stale > 0:
		status, headline = "attention", plural(int64(stale), "device hasn't", "devices haven't")+" checked in recently"
	case updates > 0:
		status, headline = "attention", "An Aavishield update is available"
	}
	return gin.H{
		"status": status, "headline": headline,
		"devices_total": len(devices), "devices_online": online,
		"settings_off": issues, "stale": stale, "updates": updates, "paused": paused,
	}
}

// ─── Work time ────────────────────────────────────────────────────────────────

// overviewWork is the employee's own tracked time, shown so monitoring is
// transparent: the person sees the same hours the company sees. Absent when the
// company doesn't monitor work time.
func (h *PortalHandler) overviewWork(c *gin.Context, emp *models.Employee, w reportWindow) (gin.H, error) {
	settings := screenshotSettingsFor(h.db, emp.OrgID)
	out := gin.H{"enabled": settings.Enabled, "screenshots_blurred": settings.Blur}
	if !settings.Enabled {
		return out, nil
	}
	st, err := dataplane.Events(c.Request.Context(), emp.OrgID)
	if err != nil {
		return nil, err
	}
	sessions, err := st.FindSessions(c.Request.Context(), dataplane.SessionQuery{
		OrgID: emp.OrgID, EmployeeID: &emp.ID, StartedSince: w.Start, StartedBefore: w.End,
	})
	if err != nil {
		return nil, err
	}

	var tracked, active, shots int64
	perDay := map[string]int64{}
	for _, s := range sessions {
		tracked += int64(s.TrackedSeconds)
		active += int64(s.ActiveSeconds)
		shots += int64(s.ScreenshotCount)
		perDay[s.StartedAt.In(w.Loc).Format("2006-01-02")] += int64(s.TrackedSeconds)
	}
	activePct := 0
	if tracked > 0 {
		activePct = int(active * 100 / tracked)
	}
	byDay := make([]gin.H, 0, len(perDay))
	for day, secs := range perDay {
		byDay = append(byDay, gin.H{"date": day, "tracked_seconds": secs})
	}
	sort.Slice(byDay, func(i, j int) bool { return byDay[i]["date"].(string) < byDay[j]["date"].(string) })

	// The most recent sessions, newest first, for a single-day view.
	recent := make([]gin.H, 0, 5)
	for i := len(sessions) - 1; i >= 0 && len(recent) < 5; i-- {
		s := sessions[i]
		recent = append(recent, gin.H{
			"started_at": s.StartedAt, "ended_at": s.EndedAt,
			"tracked_seconds": s.TrackedSeconds, "avg_activity": int(s.AvgActivity),
		})
	}

	avgPerDay := int64(0)
	if len(perDay) > 0 {
		avgPerDay = tracked / int64(len(perDay))
	}
	out["tracked_seconds"] = tracked
	out["active_seconds"] = active
	out["active_percent"] = activePct
	out["days_worked"] = len(perDay)
	out["avg_per_day_seconds"] = avgPerDay
	out["sessions"] = len(sessions)
	out["screenshots"] = shots
	out["by_day"] = byDay
	out["recent_sessions"] = recent
	return out, nil
}

// ─── Access requests ──────────────────────────────────────────────────────────

func (h *PortalHandler) overviewRequests(emp *models.Employee, w reportWindow) (gin.H, map[string]string) {
	var pending int64
	h.db.Model(&models.AccessRequest{}).
		Where("employee_id = ? AND org_id = ? AND status = ?", emp.ID, emp.OrgID, models.AccessRequestPending).
		Count(&pending)

	type statusCount struct {
		Status string
		N      int64
	}
	var counts []statusCount
	h.db.Model(&models.AccessRequest{}).Select("status, COUNT(*) AS n").
		Where("employee_id = ? AND org_id = ? AND created_at >= ? AND created_at < ?", emp.ID, emp.OrgID, w.Start, w.End).
		Group("status").Scan(&counts)
	inPeriod := map[string]int64{}
	for _, s := range counts {
		inPeriod[s.Status] = s.N
	}

	var recent []models.AccessRequest
	h.db.Where("employee_id = ? AND org_id = ?", emp.ID, emp.OrgID).Order("created_at DESC").Limit(4).Find(&recent)
	rows := make([]gin.H, 0, len(recent))
	for _, r := range recent {
		label := r.Label
		if label == "" {
			label = r.Domain
		}
		rows = append(rows, gin.H{
			"id": r.ID, "kind": r.Kind, "label": label, "status": r.Status,
			"created_at": r.CreatedAt, "reviewed_at": r.ReviewedAt, "review_note": r.ReviewNote,
		})
	}

	// Latest request status per website, so a blocked site on the dashboard
	// can say "requested" or "approved" instead of inviting a duplicate.
	var sites []models.AccessRequest
	h.db.Select("resource", "domain", "status", "created_at").
		Where("employee_id = ? AND org_id = ? AND kind = ?", emp.ID, emp.OrgID, models.AccessKindWebsite).
		Order("created_at DESC").Limit(200).Find(&sites)
	bySite := map[string]string{}
	for _, r := range sites {
		key := strings.ToLower(r.Domain)
		if key == "" {
			key = strings.ToLower(r.Resource)
		}
		if _, seen := bySite[key]; !seen && key != "" {
			bySite[key] = string(r.Status)
		}
	}

	return gin.H{
		"pending":   pending,
		"in_period": inPeriod,
		"recent":    rows,
	}, bySite
}

// ─── Recent incidents ─────────────────────────────────────────────────────────

// recentIncidents lists the latest blocked or flagged events, newest first.
// Only what an employee needs to recognise the event — never matched content,
// IP addresses or internal IDs.
func recentIncidents(d *reportData, w reportWindow, limit int) []gin.H {
	events := d.incidents(nil)
	if len(events) > limit {
		events = events[:limit]
	}
	out := make([]gin.H, 0, len(events))
	for _, e := range events {
		what := e.Domain
		if what == "" || e.Control == "apps" || e.Control == "vpn" {
			what = e.Target
		}
		if e.Category == "dlp" && e.Service != "" {
			what = e.Service
		}
		row := gin.H{
			"at": e.At, "control": e.Control, "control_label": controlLabel(e.Control),
			"action": e.Action, "what": what, "operation": e.Operation,
			"policy": strings.TrimSpace(policyPrefix.ReplaceAllString(e.Policy, "")),
		}
		if len(e.Detectors) > 0 {
			names := make([]string, 0, len(e.Detectors))
			for _, id := range e.Detectors {
				names = append(names, detectorLabel(id))
			}
			row["data_types"] = names
		}
		out = append(out, row)
	}
	return out
}

// ─── Tips ─────────────────────────────────────────────────────────────────────

type employeeTip struct {
	Severity string `json:"severity"` // high | medium | info
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	Href     string `json:"href,omitempty"`
	Action   string `json:"action,omitempty"`
}

// employeeTips is the short, personal to-do list — most urgent first, each
// pointing at the page where it gets done.
func employeeTips(devices []overviewDevice, stats []controlStat, highDLP int, requests gin.H, sites []gin.H) []employeeTip {
	tips := []employeeTip{}
	if len(devices) == 0 {
		tips = append(tips, employeeTip{"high", "Install Aavishield on your laptop",
			"Your company's protection isn't running on any of your devices yet.", "/dashboard/download", "Download"})
	}
	for _, d := range devices {
		for _, is := range d.Issues {
			tips = append(tips, employeeTip{"high", is.Name + " is off on " + d.Hostname,
				"To fix: " + is.Fix + ". The warning clears by itself on the next check-in.", "/dashboard/devices", "View device"})
		}
		if d.Stale {
			when := "never"
			if d.LastSeenAt != nil {
				when = d.LastSeenAt.Format("2 Jan")
			}
			tips = append(tips, employeeTip{"medium", d.Hostname + " hasn't checked in since " + when,
				"Make sure the laptop is on, connected and the Aavishield app is running.", "/dashboard/devices", "View device"})
		}
		if d.UpdateAvailable {
			tips = append(tips, employeeTip{"medium", "Update Aavishield on " + d.Hostname,
				fmt.Sprintf("You have %s; %s is available.", d.AgentVersion, d.LatestVersion), "/dashboard/download", "Get update"})
		}
	}
	if highDLP > 0 {
		tips = append(tips, employeeTip{"medium", plural(int64(highDLP), "high-risk data share was", "high-risk data shares were") + " flagged",
			"Sensitive information like card numbers or ID documents left your laptop. Share it only through channels your company approves.",
			"/dashboard/activity?source=dlp", "Review"})
	}
	for _, s := range stats {
		if s.ID == "vpn" && s.Count > 0 {
			tips = append(tips, employeeTip{"medium", "VPN apps are blocked by your company",
				"Personal VPNs and proxies stop company protection from working, so they're closed when they start.", "", ""})
		}
	}
	if n, _ := requests["pending"].(int64); n > 0 {
		tips = append(tips, employeeTip{"info", plural(n, "access request is", "access requests are") + " waiting for IT",
			"You'll get an email as soon as someone decides.", "/dashboard/activity?view=requests", "View"})
	}
	for _, s := range sites {
		if s["request_status"] == "" {
			if cnt, _ := s["count"].(int); cnt >= 3 {
				tips = append(tips, employeeTip{"info", fmt.Sprintf("Need %v for work?", s["domain"]),
					fmt.Sprintf("It was blocked %d times. If you need it for your job, ask your company for access.", cnt),
					"/dashboard/activity?action=blocked", "Request access"})
				break
			}
		}
	}
	if len(tips) > 6 {
		tips = tips[:6]
	}
	return tips
}
