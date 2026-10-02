package handlers

import (
	"context"
	"log"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Reports aggregate in Go over one pass of the period's events, not in SQL.
// They used to be a dozen Postgres queries (FILTER, LATERAL jsonb unnesting,
// date_trunc … AT TIME ZONE, joins to employees), which could not run against
// a company's own MySQL, SQL Server or MongoDB database; one scan through the
// data plane runs the same everywhere, and one pass is cheaper than a dozen
// queries anyway. Each event is reduced to a reportEvent on the way in, so a
// month of activity stays small in memory.

// reportEvent is the part of an activity event the reports read.
type reportEvent struct {
	At        time.Time
	Employee  *uuid.UUID
	Device    *uuid.UUID
	Action    string
	Category  string
	Control   string
	Target    string
	Domain    string
	Operation string
	Policy    string
	PolicyID  *uuid.UUID
	Risk      float64
	Service   string
	Band      string
	Kind      string
	Detectors []string
}

func (e *reportEvent) incident() bool {
	return e.Action == string(models.EventActionBlocked) || e.Action == string(models.EventActionAlerted)
}

// highDLP is a finding that would be blocked under a blocking policy.
func (e *reportEvent) highDLP() bool {
	return e.Category == "dlp" && (e.Band == "block" || e.Risk >= 80)
}

// controlOf maps an event to the control that produced it. VPN is carved out
// of app control because a bypass attempt is a different conversation with an
// employee than a blocked chat app.
func controlOf(category, operation, target string) string {
	switch {
	case category == "dlp":
		return "dlp"
	case category == "malware_detection" || category == "threat_intelligence":
		return "threats"
	case category == "vpn" || containsFold(operation, "vpn") ||
		(category == "application_control" && containsFold(target, "vpn")):
		return "vpn"
	case category == "application_control":
		return "apps"
	case category == "device" || category == "device_posture":
		return "devices"
	}
	return "web"
}

func containsFold(s, sub string) bool {
	return strings.Contains(strings.ToLower(s), sub)
}

// dlpService is where sensitive data was going: the service DLP recognised
// (Gmail, ChatGPT...), else the destination domain.
func dlpService(meta map[string]any, domain string) string {
	for _, k := range []string{"service", "app_name"} {
		if s, _ := meta[k].(string); s != "" {
			return s
		}
	}
	if domain != "" {
		return domain
	}
	return "Unknown"
}

func toReportEvent(ev *models.ActivityEvent) reportEvent {
	r := reportEvent{
		At: ev.Timestamp, Employee: ev.EmployeeID, Device: ev.DeviceID,
		Action: string(ev.Action), Category: ev.Category,
		Target: ev.Target, Domain: ev.TargetDomain, Operation: ev.Operation,
		Policy: ev.PolicyName, PolicyID: ev.PolicyID, Risk: ev.RiskScore,
	}
	r.Control = controlOf(r.Category, r.Operation, r.Target)
	r.Band, _ = ev.Metadata["band"].(string)
	r.Kind, _ = ev.Metadata["content_kind"].(string)
	if r.Category == "dlp" {
		r.Service = dlpService(ev.Metadata, ev.TargetDomain)
		if list, ok := ev.Metadata["detectors"].([]any); ok {
			for _, d := range list {
				if s, ok := d.(string); ok && s != "" {
					r.Detectors = append(r.Detectors, s)
				}
			}
		}
	}
	return r
}

// reportData is one period's events plus the previous period's counts.
type reportData struct {
	cur       []reportEvent    // [Start, End), oldest first
	prev      map[string]int64 // control → incidents in [PrevStart, PrevEnd)
	truncated bool
}

// maxReportEvents bounds one report's scan. Far above any real month for the
// companies on the platform; reaching it is logged and the report says so.
const maxReportEvents = 500000

func (h *ReportHandler) loadReport(ctx context.Context, orgID string, w reportWindow) (*reportData, error) {
	st, err := dataplane.EventsFor(ctx, orgID)
	if err != nil {
		return nil, err
	}
	org, _ := uuid.Parse(orgID)
	q := dataplane.EventQuery{
		OrgID:      org,
		Since:      w.PrevStart,
		Before:     w.End,
		NotActions: dataplane.Strings(models.EventActionAllowed),
		// Only what reports read: incidents, and DLP findings (which count
		// even when only logged). Routine logged telemetry is left behind.
		AnyOf: []dataplane.EventClause{
			{Actions: dataplane.Strings(models.EventActionBlocked, models.EventActionAlerted)},
			{Categories: []string{"dlp"}},
		},
		Ascending: true,
		Limit:     maxReportEvents + 1,
		Fields: []string{"employee_id", "device_id", "action", "category", "target", "target_domain",
			"operation", "policy_id", "policy_name", "risk_score", "metadata", "timestamp"},
	}
	if w.EmployeeID != "" {
		id, _ := uuid.Parse(w.EmployeeID)
		q.EmployeeID = &id
	}
	d := &reportData{prev: map[string]int64{}}
	n := 0
	err = st.EachEvent(ctx, q, func(ev *models.ActivityEvent) error {
		n++
		if n > maxReportEvents {
			d.truncated = true
			return errStopScan
		}
		if ev.Timestamp.Before(w.Start) {
			if ev.Action == models.EventActionBlocked || ev.Action == models.EventActionAlerted {
				d.prev[controlOf(ev.Category, ev.Operation, ev.Target)]++
			}
			return nil
		}
		d.cur = append(d.cur, toReportEvent(ev))
		return nil
	})
	if err != nil && err != errStopScan {
		return nil, err
	}
	if d.truncated {
		log.Printf("report for org %s stopped at %d events", orgID, maxReportEvents)
	}
	return d, nil
}

type stopScan struct{}

func (stopScan) Error() string { return "stop" }

var errStopScan error = stopScan{}

// incidents returns the period's incidents matching keep, newest first.
func (d *reportData) incidents(keep func(*reportEvent) bool) []*reportEvent {
	var out []*reportEvent
	for i := len(d.cur) - 1; i >= 0; i-- {
		e := &d.cur[i]
		if e.incident() && (keep == nil || keep(e)) {
			out = append(out, e)
		}
	}
	return out
}

// ─── Names, from Aavishield's own tables ─────────────────────────────────────

type personInfo struct {
	Name, Email, Department string
}

// peopleFor looks up the employees referenced by events. Employees are the
// control plane — always in Aavishield's database — so this is the in-Go
// equivalent of the JOIN the SQL reports used to do.
func peopleFor(db *gorm.DB, events []*reportEvent) map[uuid.UUID]personInfo {
	ids := map[uuid.UUID]bool{}
	for _, e := range events {
		if e.Employee != nil {
			ids[*e.Employee] = true
		}
	}
	out := map[uuid.UUID]personInfo{}
	if len(ids) == 0 {
		return out
	}
	list := make([]uuid.UUID, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	var emps []models.Employee
	db.Select("id", "first_name", "last_name", "email", "department").Where("id IN ?", list).Find(&emps)
	for _, e := range emps {
		out[e.ID] = personInfo{
			Name:       strings.TrimSpace(strings.TrimSpace(e.FirstName) + " " + strings.TrimSpace(e.LastName)),
			Email:      e.Email,
			Department: e.Department,
		}
	}
	return out
}

func hostnamesFor(db *gorm.DB, events []*reportEvent) map[uuid.UUID]string {
	ids := map[uuid.UUID]bool{}
	for _, e := range events {
		if e.Device != nil {
			ids[*e.Device] = true
		}
	}
	out := map[uuid.UUID]string{}
	if len(ids) == 0 {
		return out
	}
	list := make([]uuid.UUID, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	var devs []models.Device
	db.Unscoped().Select("id", "hostname").Where("id IN ?", list).Find(&devs)
	for _, d := range devs {
		out[d.ID] = d.Hostname
	}
	return out
}

// ─── Small aggregation helpers ───────────────────────────────────────────────

var policyPrefix = regexp.MustCompile(`(?i)^Policy:\s*`)

// siteCategory names why a site was blocked. Web events carry the policy
// ("Policy: Social media") rather than a separate category field.
func siteCategory(maxPolicy, maxCategory string) string {
	if p := strings.TrimSpace(policyPrefix.ReplaceAllString(maxPolicy, "")); p != "" {
		return p
	}
	return maxCategory
}

type employeeSet map[uuid.UUID]bool

func (s employeeSet) add(id *uuid.UUID) {
	if id != nil {
		s[*id] = true
	}
}

func sortByCountThenName[T any](rows []T, count func(T) int, name func(T) string) {
	sort.SliceStable(rows, func(i, j int) bool {
		ci, cj := count(rows[i]), count(rows[j])
		if ci != cj {
			return ci > cj
		}
		return name(rows[i]) < name(rows[j])
	})
}
