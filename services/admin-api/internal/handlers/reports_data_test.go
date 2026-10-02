package handlers

import (
	"testing"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
)

// controlOf replaces the controlSQL CASE expression; these are its branches.
func TestControlOf(t *testing.T) {
	cases := []struct{ category, operation, target, want string }{
		{"dlp", "", "", "dlp"},
		{"malware_detection", "", "", "threats"},
		{"threat_intelligence", "", "", "threats"},
		{"vpn", "", "", "vpn"},
		{"", "VPN extension installed", "", "vpn"},
		{"application_control", "App launch", "NordVPN", "vpn"},
		{"application_control", "App launch", "Telegram", "apps"},
		{"device", "", "", "devices"},
		{"device_posture", "", "", "devices"},
		{"", "", "", "web"},
		{"url_category", "", "x.vpn.example", "web"}, // target only counts for app control
	}
	for _, c := range cases {
		if got := controlOf(c.category, c.operation, c.target); got != c.want {
			t.Errorf("controlOf(%q, %q, %q) = %q, want %q", c.category, c.operation, c.target, got, c.want)
		}
	}
}

func TestSiteCategory(t *testing.T) {
	if got := siteCategory("Policy: Social media", "url_category"); got != "Social media" {
		t.Errorf("got %q", got)
	}
	if got := siteCategory("policy:   ", "domain"); got != "domain" {
		t.Errorf("empty policy should fall back to the category, got %q", got)
	}
}

func TestDLPService(t *testing.T) {
	if got := dlpService(map[string]any{"service": "Gmail", "app_name": "Chrome"}, "mail.google.com"); got != "Gmail" {
		t.Errorf("got %q", got)
	}
	if got := dlpService(map[string]any{"app_name": "Slack"}, "slack.com"); got != "Slack" {
		t.Errorf("got %q", got)
	}
	if got := dlpService(nil, "x.com"); got != "x.com" {
		t.Errorf("got %q", got)
	}
	if got := dlpService(nil, ""); got != "Unknown" {
		t.Errorf("got %q", got)
	}
}

func reportFixture() (*reportData, reportWindow) {
	loc := time.UTC
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, loc)
	w := reportWindow{Start: start, End: start.AddDate(0, 0, 3), PrevStart: start.AddDate(0, 0, -3), PrevEnd: start, Loc: loc}
	a, b := uuid.New(), uuid.New()
	ev := func(day int, action models.EventAction, category, target, domain string, emp *uuid.UUID, meta map[string]any) reportEvent {
		return toReportEvent(&models.ActivityEvent{
			Timestamp: start.AddDate(0, 0, day).Add(time.Hour), Action: action, Category: category,
			Target: target, TargetDomain: domain, EmployeeID: emp, Metadata: meta, RiskScore: 50,
		})
	}
	d := &reportData{prev: map[string]int64{"web": 2}, cur: []reportEvent{
		ev(0, models.EventActionBlocked, "", "", "facebook.com", &a, nil),
		ev(0, models.EventActionBlocked, "", "", "facebook.com", &b, nil),
		ev(1, models.EventActionBlocked, "", "", "youtube.com", &a, nil),
		ev(1, models.EventActionAlerted, "dlp", "", "mail.google.com", &a, map[string]any{"band": "block", "service": "Gmail", "detectors": []any{"credit_card", "aadhaar"}}),
		ev(2, models.EventActionLogged, "dlp", "", "chat.openai.com", &b, map[string]any{"service": "ChatGPT", "detectors": []any{"credit_card"}}),
		ev(2, models.EventActionBlocked, "application_control", "NordVPN", "", &b, nil),
		ev(2, models.EventActionLogged, "device", "laptop", "", nil, nil), // context, not an incident
	}}
	return d, w
}

func TestReportAggregations(t *testing.T) {
	d, w := reportFixture()

	stats, total, prev := controlStats(d)
	if total != 5 || prev != 2 {
		t.Fatalf("total=%d prev=%d, want 5 and 2", total, prev)
	}
	byID := map[string]controlStat{}
	for _, s := range stats {
		byID[s.ID] = s
	}
	if byID["web"].Count != 3 || byID["web"].Blocked != 3 || byID["dlp"].Alerted != 1 || byID["vpn"].Count != 1 {
		t.Fatalf("unexpected control stats: %+v", byID)
	}
	if byID["web"].Delta == nil || *byID["web"].Delta != 50 {
		t.Fatalf("web delta = %v, want +50%%", byID["web"].Delta)
	}

	sites := topSites(d, 10)
	if len(sites) != 2 || sites[0].Domain != "facebook.com" || sites[0].Count != 2 || sites[0].Employees != 2 {
		t.Fatalf("top sites = %+v", sites)
	}

	apps := topApps(d, 10)
	if len(apps) != 1 || apps[0].Name != "NordVPN" || apps[0].Control != "vpn" {
		t.Fatalf("top apps = %+v", apps)
	}

	// DLP figures include logged findings, not just incidents.
	svc := dlpServices(d, 10)
	if len(svc) != 2 || svc[0].Count != 1 {
		t.Fatalf("dlp services = %+v", svc)
	}
	high := 0
	for _, s := range svc {
		high += s.High
	}
	if high != 1 {
		t.Fatalf("high-severity DLP = %d, want 1", high)
	}
	types := dlpTypes(d, 10)
	if len(types) != 2 || types[0].Label != "Credit card" || types[0].Count != 2 {
		t.Fatalf("dlp types = %+v", types)
	}

	tr := trend(d, w, nil)
	if len(tr) != 3 {
		t.Fatalf("trend has %d points, want one per day (3)", len(tr))
	}
	if tr[0]["web"] != 2 || tr[1]["total"] != 2 || tr[2]["vpn"] != 1 || tr[2]["devices"] != 0 {
		t.Fatalf("trend = %+v", tr)
	}

	if items := attention(d, health{}, stats); len(items) == 0 {
		t.Fatal("a high-severity leak and a VPN attempt should need attention")
	}
}
