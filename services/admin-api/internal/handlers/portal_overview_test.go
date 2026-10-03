package handlers

import (
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestVersionLess(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"2.9.0", "2.9.1", true},
		{"2.9.1", "2.9.1", false},
		{"2.10.0", "2.9.9", false},
		{"2.9", "2.9.1", true},
		{"v2.8.0", "2.9.0", true},
		{"2.9.1-beta", "2.9.1", false},
		{"garbage", "2.9.1", false}, // unparseable never claims an update
	}
	for _, c := range cases {
		if got := versionLess(c.a, c.b); got != c.want {
			t.Errorf("versionLess(%q,%q)=%v want %v", c.a, c.b, got, c.want)
		}
	}
}

func dev(status string, stale bool, issues int, update bool) overviewDevice {
	d := overviewDevice{Hostname: "mac", Status: status, Stale: stale, UpdateAvailable: update,
		Enforcement: gin.H{"active": true}}
	for i := 0; i < issues; i++ {
		d.Issues = append(d.Issues, overviewIssue{Name: "Firewall", Fix: "turn it on"})
	}
	return d
}

func TestProtectionSummary(t *testing.T) {
	cases := []struct {
		name    string
		devices []overviewDevice
		want    string
	}{
		{"no devices", nil, "unprotected"},
		{"all stale", []overviewDevice{dev("offline", true, 0, false)}, "unprotected"},
		{"setting off", []overviewDevice{dev("online", false, 1, false)}, "attention"},
		{"one of two stale", []overviewDevice{dev("online", false, 0, false), dev("offline", true, 0, false)}, "attention"},
		{"update due", []overviewDevice{dev("online", false, 0, true)}, "attention"},
		{"healthy", []overviewDevice{dev("online", false, 0, false)}, "protected"},
	}
	for _, c := range cases {
		if got := protectionSummary(c.devices)["status"]; got != c.want {
			t.Errorf("%s: status=%v want %v", c.name, got, c.want)
		}
	}
}

func TestEmployeeTips(t *testing.T) {
	seen := time.Now().Add(-10 * 24 * time.Hour)
	stale := dev("offline", true, 0, false)
	stale.LastSeenAt = &seen
	tips := employeeTips(
		[]overviewDevice{dev("online", false, 1, true), stale},
		[]controlStat{{ID: "vpn", Count: 2}},
		1,
		gin.H{"pending": int64(2)},
		[]gin.H{{"domain": "linkedin.com", "count": 4, "request_status": ""}},
	)
	if len(tips) == 0 || tips[0].Severity != "high" {
		t.Fatalf("a setting that is off must come first: %+v", tips)
	}
	if len(tips) > 6 {
		t.Fatalf("tips are capped at 6, got %d", len(tips))
	}
	if got := employeeTips(nil, nil, 0, gin.H{"pending": int64(0)}, nil); len(got) != 1 || got[0].Href != "/dashboard/download" {
		t.Fatalf("no device should produce exactly the install tip, got %+v", got)
	}
}
