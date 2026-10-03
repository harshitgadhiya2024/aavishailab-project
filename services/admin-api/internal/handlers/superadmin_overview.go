package handlers

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// The superadmin home answers three questions in one request: how is the
// business doing, which customers need us, and is the fleet healthy. Every
// number is computed from real rows — nothing synthetic — and the result is
// cached briefly, because the page polls and the numbers move slowly.

type SuperadminOverviewHandler struct {
	db *gorm.DB

	mu       sync.Mutex
	cached   gin.H
	cachedAt time.Time
}

func NewSuperadminOverviewHandler(db *gorm.DB) *SuperadminOverviewHandler {
	return &SuperadminOverviewHandler{db: db}
}

const overviewCacheTTL = 30 * time.Second

// saAttention is one thing a person on the Aavishield team should act on.
type saAttention struct {
	Kind     string `json:"kind"`
	Severity string `json:"severity"` // critical | warning | info
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	Href     string `json:"href"`
	Count    int64  `json:"count,omitempty"`
}

// Get handles GET /superadmin/overview.
func (h *SuperadminOverviewHandler) Get(c *gin.Context) {
	h.mu.Lock()
	if h.cached != nil && time.Since(h.cachedAt) < overviewCacheTTL && c.Query("fresh") == "" {
		out := h.cached
		h.mu.Unlock()
		c.JSON(http.StatusOK, out)
		return
	}
	h.mu.Unlock()

	now := time.Now()
	out := gin.H{
		"generated_at": now.UTC(),
		"business":     h.business(now),
		"customers":    h.customers(now),
		"fleet":        h.fleet(now),
		"usage":        h.usage(c, now),
	}
	out["attention"] = h.attention(now)
	out["recent_orgs"] = h.recentOrgs()
	out["recent_audit"] = h.recentAudit()
	var openTickets, newDemos int64
	h.db.Model(&models.SupportTicket{}).Where("status IN ?", []string{"open", "in_progress"}).Count(&openTickets)
	h.db.Model(&models.DemoRequest{}).Where("status = ?", models.DemoRequestNew).Count(&newDemos)
	out["badges"] = gin.H{"tickets_open": openTickets, "demo_requests_new": newDemos}

	h.mu.Lock()
	h.cached, h.cachedAt = out, now
	h.mu.Unlock()
	c.JSON(http.StatusOK, out)
}

func (h *SuperadminOverviewHandler) business(now time.Time) gin.H {
	// MRR: each org's most recent paid invoice, normalised to a month
	// (annual / 12; one-time is not recurring). Same rule as the revenue page.
	var rows []orgMRRRow
	h.db.Raw(`
		SELECT DISTINCT ON (org_id) org_id, amount_paise, billing_cycle
		FROM billing_records
		WHERE status = ? AND deleted_at IS NULL
		ORDER BY org_id, paid_at DESC
	`, models.BillingStatusPaid).Scan(&rows)
	var mrr int64
	paying := 0
	for _, r := range rows {
		switch r.BillingCycle {
		case "monthly":
			mrr += r.AmountPaise
			paying++
		case "annual":
			mrr += r.AmountPaise / 12
			paying++
		}
	}

	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	prevMonthStart := monthStart.AddDate(0, -1, 0)
	var collectedThisMonth, collectedLastMonth, pending, overdueAmount int64
	var overdueCount int64
	h.db.Model(&models.BillingRecord{}).Where("status = ? AND paid_at >= ?", models.BillingStatusPaid, monthStart).
		Select("COALESCE(SUM(amount_paise),0)").Scan(&collectedThisMonth)
	h.db.Model(&models.BillingRecord{}).Where("status = ? AND paid_at >= ? AND paid_at < ?", models.BillingStatusPaid, prevMonthStart, monthStart).
		Select("COALESCE(SUM(amount_paise),0)").Scan(&collectedLastMonth)
	h.db.Model(&models.BillingRecord{}).Where("status = ?", models.BillingStatusPending).
		Select("COALESCE(SUM(amount_paise),0)").Scan(&pending)
	h.db.Model(&models.BillingRecord{}).Where("status = ? AND period_end < ?", models.BillingStatusPending, now).Count(&overdueCount)
	h.db.Model(&models.BillingRecord{}).Where("status = ? AND period_end < ?", models.BillingStatusPending, now).
		Select("COALESCE(SUM(amount_paise),0)").Scan(&overdueAmount)

	return gin.H{
		"currency":                   "INR",
		"mrr_paise":                  mrr,
		"arr_paise":                  mrr * 12,
		"paying_orgs":                paying,
		"collected_this_month_paise": collectedThisMonth,
		"collected_last_month_paise": collectedLastMonth,
		"pending_paise":              pending,
		"overdue_invoices":           overdueCount,
		"overdue_paise":              overdueAmount,
	}
}

func (h *SuperadminOverviewHandler) customers(now time.Time) gin.H {
	type kv struct {
		K string
		N int64
	}
	var byStatus, byPlan []kv
	h.db.Raw(`SELECT status AS k, COUNT(*) AS n FROM organizations WHERE deleted_at IS NULL GROUP BY status`).Scan(&byStatus)
	h.db.Raw(`SELECT plan AS k, COUNT(*) AS n FROM organizations WHERE deleted_at IS NULL GROUP BY plan`).Scan(&byPlan)
	toMap := func(rows []kv) (map[string]int64, int64) {
		m := map[string]int64{}
		var total int64
		for _, r := range rows {
			m[r.K] = r.N
			total += r.N
		}
		return m, total
	}
	statusMap, total := toMap(byStatus)
	planMap, _ := toMap(byPlan)

	var new30, prev30, trialsEnding7d int64
	h.db.Model(&models.Organization{}).Where("created_at >= ?", now.AddDate(0, 0, -30)).Count(&new30)
	h.db.Model(&models.Organization{}).Where("created_at >= ? AND created_at < ?", now.AddDate(0, 0, -60), now.AddDate(0, 0, -30)).Count(&prev30)
	h.db.Model(&models.Organization{}).Where("status = ? AND trial_ends_at BETWEEN ? AND ?", models.OrgStatusTrial, now, now.AddDate(0, 0, 7)).Count(&trialsEnding7d)

	// New organizations per week, oldest first, for the last 12 weeks.
	weekStart := startOfWeek(now).AddDate(0, 0, -7*11)
	var created []time.Time
	h.db.Model(&models.Organization{}).Where("created_at >= ?", weekStart).Pluck("created_at", &created)
	weeks := make([]gin.H, 12)
	counts := make([]int, 12)
	for _, t := range created {
		i := int(t.Sub(weekStart).Hours() / (24 * 7))
		if i >= 0 && i < 12 {
			counts[i]++
		}
	}
	for i := range weeks {
		weeks[i] = gin.H{"week": weekStart.AddDate(0, 0, 7*i).Format("2006-01-02"), "count": counts[i]}
	}

	var users, employees int64
	h.db.Model(&models.User{}).Where("org_id IS NOT NULL").Count(&users)
	h.db.Model(&models.Employee{}).Count(&employees)

	return gin.H{
		"total":            total,
		"by_status":        statusMap,
		"by_plan":          planMap,
		"new_30d":          new30,
		"new_prev_30d":     prev30,
		"trials_ending_7d": trialsEnding7d,
		"signups_by_week":  weeks,
		"admin_users":      users,
		"employees":        employees,
	}
}

func startOfWeek(t time.Time) time.Time {
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	offset := (int(d.Weekday()) + 6) % 7 // Monday
	return d.AddDate(0, 0, -offset)
}

func (h *SuperadminOverviewHandler) fleet(now time.Time) gin.H {
	type row struct {
		Status       string
		AgentVersion string
		OSType       string
		LastSeenAt   *time.Time
	}
	var devices []row
	h.db.Model(&models.Device{}).Where("status <> ?", "revoked").
		Select("status, agent_version, os_type, last_seen_at").Scan(&devices)

	latest := ""
	if m, err := readManifest(); err == nil {
		latest = m.Version
	}

	var online, seen24h, outdated int64
	versions := map[string]int64{}
	byOS := map[string]int64{}
	for _, d := range devices {
		if d.Status == "online" {
			online++
		}
		if d.LastSeenAt != nil && now.Sub(*d.LastSeenAt) < 24*time.Hour {
			seen24h++
		}
		v := d.AgentVersion
		if v == "" {
			v = "unknown"
		}
		versions[v]++
		if latest != "" && d.AgentVersion != latest {
			outdated++
		}
		byOS[normalizeOS(d.OSType)]++
	}

	type vc struct {
		Version string `json:"version"`
		Count   int64  `json:"count"`
		Latest  bool   `json:"latest"`
	}
	vs := make([]vc, 0, len(versions))
	for v, n := range versions {
		vs = append(vs, vc{Version: v, Count: n, Latest: v == latest})
	}
	sort.Slice(vs, func(i, j int) bool {
		if vs[i].Count != vs[j].Count {
			return vs[i].Count > vs[j].Count
		}
		return vs[i].Version > vs[j].Version
	})

	return gin.H{
		"devices":        len(devices),
		"online":         online,
		"seen_24h":       seen24h,
		"latest_version": latest,
		"outdated":       outdated,
		"versions":       vs,
		"by_os":          byOS,
	}
}

func normalizeOS(s string) string {
	switch strings.ToLower(s) {
	case "darwin", "macos", "mac":
		return "macos"
	case "windows", "win32":
		return "windows"
	case "linux":
		return "linux"
	case "":
		return "unknown"
	}
	return strings.ToLower(s)
}

// usage is security-event volume Aavishield itself stores, per day for the
// last 14 days. Companies that keep their data in their own database are not
// read here — their data is theirs.
func (h *SuperadminOverviewHandler) usage(c *gin.Context, now time.Time) gin.H {
	st := dataplane.Primary()
	if st == nil {
		return gin.H{"events_by_day": []gin.H{}, "events_14d": 0}
	}
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	const days = 14
	out := make([]gin.H, days)
	var total int64
	var wg sync.WaitGroup
	var mu sync.Mutex
	for i := 0; i < days; i++ {
		i := i
		from := day.AddDate(0, 0, i-(days-1))
		wg.Add(1)
		go func() {
			defer wg.Done()
			n, _ := st.CountEvents(c.Request.Context(), dataplane.EventQuery{
				NotActions: dataplane.Strings(models.EventActionAllowed),
				Since:      from, Before: from.AddDate(0, 0, 1),
			})
			blocked, _ := st.CountEvents(c.Request.Context(), dataplane.EventQuery{
				Actions: dataplane.Strings(models.EventActionBlocked),
				Since:   from, Before: from.AddDate(0, 0, 1),
			})
			mu.Lock()
			out[i] = gin.H{"date": from.Format("2006-01-02"), "events": n, "blocked": blocked}
			total += n
			mu.Unlock()
		}()
	}
	wg.Wait()

	var ownStorage int64
	h.db.Model(&models.OrgDataResidency{}).Where("enabled = ?", true).Count(&ownStorage)
	return gin.H{"events_by_day": out, "events_14d": total, "orgs_on_own_storage": ownStorage}
}

func (h *SuperadminOverviewHandler) attention(now time.Time) []saAttention {
	items := []saAttention{}

	var urgent, open int64
	h.db.Model(&models.SupportTicket{}).Where("status IN ?", []string{"open", "in_progress"}).Count(&open)
	h.db.Model(&models.SupportTicket{}).Where("status IN ? AND priority IN ?", []string{"open", "in_progress"}, []string{"urgent", "high"}).Count(&urgent)
	if urgent > 0 {
		items = append(items, saAttention{Kind: "tickets_urgent", Severity: "critical", Count: urgent,
			Title:  plural(urgent, "urgent or high-priority ticket", "urgent or high-priority tickets"),
			Detail: "Customers waiting on a reply", Href: "/dashboard/tickets"})
	} else if open > 0 {
		items = append(items, saAttention{Kind: "tickets_open", Severity: "info", Count: open,
			Title: plural(open, "open support ticket", "open support tickets"), Detail: "Waiting on the support team", Href: "/dashboard/tickets"})
	}

	var demos int64
	h.db.Model(&models.DemoRequest{}).Where("status = ?", models.DemoRequestNew).Count(&demos)
	if demos > 0 {
		items = append(items, saAttention{Kind: "demo_requests", Severity: "warning", Count: demos,
			Title: plural(demos, "new demo request", "new demo requests"), Detail: "Leads from the website, not contacted yet", Href: "/dashboard/demo-requests"})
	}

	var down []struct{ OrgID, Name, DBStatus, FilesStatus string }
	h.db.Raw(`SELECT r.org_id, o.name, r.db_status, r.files_status FROM org_data_residency r
		JOIN organizations o ON o.id = r.org_id AND o.deleted_at IS NULL
		WHERE r.enabled AND r.deleted_at IS NULL AND (r.db_status = ? OR r.files_status = ?)`,
		models.ResidencyStatusUnreachable, models.ResidencyStatusUnreachable).Scan(&down)
	for _, d := range down {
		items = append(items, saAttention{Kind: "residency_down", Severity: "critical",
			Title: d.Name + "'s own database or storage is unreachable", Detail: "Their activity is being held until it reconnects",
			Href: "/dashboard/organizations/" + d.OrgID})
	}

	var overdue int64
	h.db.Model(&models.BillingRecord{}).Where("status = ? AND period_end < ?", models.BillingStatusPending, now).Count(&overdue)
	if overdue > 0 {
		items = append(items, saAttention{Kind: "invoices_overdue", Severity: "warning", Count: overdue,
			Title: plural(overdue, "overdue invoice", "overdue invoices"), Detail: "Payment links past their period end", Href: "/dashboard/billing"})
	}

	var ending []struct {
		ID          string
		Name        string
		TrialEndsAt time.Time
	}
	h.db.Model(&models.Organization{}).Select("id, name, trial_ends_at").
		Where("status = ? AND trial_ends_at BETWEEN ? AND ?", models.OrgStatusTrial, now, now.AddDate(0, 0, 7)).
		Order("trial_ends_at").Limit(5).Scan(&ending)
	for _, o := range ending {
		d := int(o.TrialEndsAt.Sub(now).Hours()/24) + 1
		items = append(items, saAttention{Kind: "trial_ending", Severity: "warning",
			Title: o.Name + "'s trial ends in " + plural(int64(d), "day", "days"), Detail: "A good moment to talk about a plan",
			Href: "/dashboard/organizations/" + o.ID})
	}

	// Onboarding stalled: signed up over 3 days ago and no device has ever
	// connected. Without a device the product does nothing for them.
	var stalled []struct{ ID, Name string }
	h.db.Raw(`SELECT o.id, o.name FROM organizations o
		WHERE o.deleted_at IS NULL AND o.status IN ('trial','active') AND o.created_at < ?
		AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.org_id = o.id AND d.deleted_at IS NULL)
		ORDER BY o.created_at DESC LIMIT 5`, now.AddDate(0, 0, -3)).Scan(&stalled)
	for _, o := range stalled {
		items = append(items, saAttention{Kind: "onboarding_stalled", Severity: "info",
			Title: o.Name + " hasn't connected a device", Detail: "Signed up but the agent isn't installed anywhere yet",
			Href: "/dashboard/organizations/" + o.ID})
	}

	// Seats: protected employees against the plan's limit.
	var seats []struct {
		ID        string
		Name      string
		MaxUsers  int
		Employees int64
	}
	h.db.Raw(`SELECT o.id, o.name, o.max_users, COUNT(e.id) AS employees FROM organizations o
		LEFT JOIN employees e ON e.org_id = o.id AND e.deleted_at IS NULL
		WHERE o.deleted_at IS NULL AND o.max_users > 0
		GROUP BY o.id, o.name, o.max_users
		HAVING COUNT(e.id) * 100 >= o.max_users * 80
		ORDER BY COUNT(e.id)::float / o.max_users DESC LIMIT 5`).Scan(&seats)
	for _, s := range seats {
		sev := "info"
		if s.Employees >= int64(s.MaxUsers) {
			sev = "warning"
		}
		items = append(items, saAttention{Kind: "seat_limit", Severity: sev,
			Title:  s.Name + " is using " + itoa(s.Employees) + " of " + itoa(int64(s.MaxUsers)) + " seats",
			Detail: "Upsell opportunity, or raise their limit", Href: "/dashboard/organizations/" + s.ID})
	}

	rank := map[string]int{"critical": 0, "warning": 1, "info": 2}
	sort.SliceStable(items, func(i, j int) bool { return rank[items[i].Severity] < rank[items[j].Severity] })
	return items
}

func (h *SuperadminOverviewHandler) recentOrgs() []gin.H {
	var orgs []models.Organization
	h.db.Order("created_at DESC").Limit(6).Find(&orgs)
	out := make([]gin.H, 0, len(orgs))
	for _, o := range orgs {
		out = append(out, gin.H{"id": o.ID, "name": o.Name, "plan": o.Plan, "status": o.Status, "created_at": o.CreatedAt})
	}
	return out
}

func (h *SuperadminOverviewHandler) recentAudit() []gin.H {
	var logs []models.AuditLog
	h.db.Order("created_at DESC").Limit(8).Find(&logs)
	orgIDs, userIDs := map[string]bool{}, map[string]bool{}
	for _, l := range logs {
		if l.OrgID != nil {
			orgIDs[l.OrgID.String()] = true
		}
		if l.UserID != nil {
			userIDs[l.UserID.String()] = true
		}
	}
	names := map[string]string{}
	if len(orgIDs) > 0 {
		var os []models.Organization
		h.db.Select("id, name").Where("id IN ?", setKeys(orgIDs)).Find(&os)
		for _, o := range os {
			names[o.ID.String()] = o.Name
		}
	}
	people := map[string]string{}
	if len(userIDs) > 0 {
		var us []models.User
		h.db.Select("id, email, first_name, last_name").Where("id IN ?", setKeys(userIDs)).Find(&us)
		for _, u := range us {
			n := strings.TrimSpace(u.FirstName + " " + u.LastName)
			if n == "" {
				n = u.Email
			}
			people[u.ID.String()] = n
		}
	}
	out := make([]gin.H, 0, len(logs))
	for _, l := range logs {
		item := gin.H{"id": l.ID, "action": l.Action, "resource": l.Resource, "created_at": l.CreatedAt}
		if l.OrgID != nil {
			item["org"] = names[l.OrgID.String()]
		}
		if l.UserID != nil {
			item["actor"] = people[l.UserID.String()]
		}
		out = append(out, item)
	}
	return out
}

func setKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
