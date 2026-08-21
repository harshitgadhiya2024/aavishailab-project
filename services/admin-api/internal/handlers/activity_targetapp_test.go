package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/shadowitclient"
)

// stubShadowIT stands in for shadowit-service, echoing back a display name for
// each domain it is asked about.
func stubShadowIT(t *testing.T, names map[string]string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Domains []string `json:"domains"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decoding classify request: %v", err)
		}
		var out struct {
			Results []shadowitclient.AppResult `json:"results"`
		}
		for _, d := range req.Domains {
			out.Results = append(out.Results, shadowitclient.AppResult{Domain: d, DisplayName: names[d]})
		}
		_ = json.NewEncoder(w).Encode(out)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("SHADOWIT_SERVICE_URL", srv.URL)
}

func TestAttachTargetApps(t *testing.T) {
	stubShadowIT(t, map[string]string{
		"teams.microsoft.com":         "Microsoft Teams",
		"browser.events.data.msn.com": "MSN",
	})

	events := []models.ActivityEvent{
		{TargetDomain: "teams.microsoft.com"},
		{TargetDomain: "WWW.Browser.Events.Data.MSN.com"}, // normalised before lookup
		{TargetDomain: ""},                                // device-posture events carry no domain
	}
	attachTargetApps(context.Background(), "org-1", events)

	if got := events[0].TargetApp; got != "Microsoft Teams" {
		t.Errorf("events[0].TargetApp = %q, want %q", got, "Microsoft Teams")
	}
	if got := events[1].TargetApp; got != "MSN" {
		t.Errorf("events[1].TargetApp = %q, want %q", got, "MSN")
	}
	if got := events[2].TargetApp; got != "" {
		t.Errorf("events[2].TargetApp = %q, want empty", got)
	}
}

// The UI falls back to the raw domain, so an unreachable shadowit-service must
// leave events untouched rather than fail the whole activity request.
func TestAttachTargetAppsFailsOpen(t *testing.T) {
	t.Setenv("SHADOWIT_SERVICE_URL", "http://127.0.0.1:1") // nothing listening

	events := []models.ActivityEvent{{TargetDomain: "teams.microsoft.com"}}
	attachTargetApps(context.Background(), "org-1", events)

	if got := events[0].TargetApp; got != "" {
		t.Errorf("TargetApp = %q, want empty when the service is unreachable", got)
	}
}

func TestAttachTargetAppsDisabled(t *testing.T) {
	t.Setenv("SHADOWIT_SERVICE_URL", "")

	events := []models.ActivityEvent{{TargetDomain: "teams.microsoft.com"}}
	attachTargetApps(context.Background(), "org-1", events)

	if got := events[0].TargetApp; got != "" {
		t.Errorf("TargetApp = %q, want empty when shadowit is not configured", got)
	}
}
