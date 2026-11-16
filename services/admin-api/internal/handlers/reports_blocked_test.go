package handlers

import (
	"testing"
	"time"
)

// The dashboard's "Blocked websites/applications" lists must hold real blocks
// only; a flagged-only visit (an app refusing SSL inspection, say) used to be
// listed there as if it had been blocked.
func TestDashboardBlockedListsHoldRealBlocksOnly(t *testing.T) {
	at := time.Now()
	web := func(domain, action string) reportEvent {
		return reportEvent{At: at, Action: action, Category: "web_filtering", Control: "web", Domain: domain}
	}
	app := func(name, action string) reportEvent {
		return reportEvent{At: at, Action: action, Category: "application_control", Control: "apps", Target: name}
	}
	d := &reportData{cur: []reportEvent{
		web("instagram.com", "blocked"), web("instagram.com", "blocked"),
		web("microsoft.com", "alerted"), web("microsoft.com", "alerted"), web("microsoft.com", "alerted"),
		web("google.com", "alerted"),
		web("bet365.com", "blocked"), web("bet365.com", "alerted"), // blocked at least once: not "only flagged"
		app("AnyDesk", "blocked"), app("Slack", "alerted"),
	}}

	sites := topSitesWhere(d, 6, blockedOnly)
	if len(sites) != 2 || sites[0].Domain != "instagram.com" || sites[0].Count != 2 || sites[1].Domain != "bet365.com" || sites[1].Count != 1 {
		t.Fatalf("blocked sites wrong: %+v", sites)
	}
	if all := topSites(d, 6); len(all) != 4 {
		t.Fatalf("the reports' site list must still include flagged sites, got %d", len(all))
	}

	f := flaggedSites(d)
	if f["domains"] != 2 || f["events"] != 4 {
		t.Fatalf("flagged-only summary wrong: %+v", f)
	}

	apps := topAppsWhere(d, 6, blockedOnly)
	if len(apps) != 1 || apps[0].Name != "AnyDesk" {
		t.Fatalf("blocked apps wrong: %+v", apps)
	}
}
