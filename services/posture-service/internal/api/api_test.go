package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aavishield/posture-service/internal/auth"
	"github.com/aavishield/posture-service/internal/config"
	"github.com/aavishield/posture-service/internal/geoip"
)

const (
	secret = "test-posture-secret"
	orgA   = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	orgB   = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
)

func srv() http.Handler {
	cfg := config.Config{ServiceSecret: secret, RequireAuth: true, PassThreshold: 80, WarnThreshold: 50}
	return New(cfg, geoip.New("")).Handler()
}

func tok(org string, ttl time.Duration) string { return auth.Mint(org, secret, ttl) }

func TestHealth(t *testing.T) {
	rr := httptest.NewRecorder()
	srv().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("health %d", rr.Code)
	}
}

func TestPostureFail(t *testing.T) {
	body := `{"org_id":"` + orgA + `","signals":{"disk_encryption":false,"firewall":false,"os_up_to_date":false,"screen_lock":true,"antivirus":true}}`
	req := httptest.NewRequest(http.MethodPost, "/v1/posture", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok(orgA, time.Minute))
	rr := httptest.NewRecorder()
	srv().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var res map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &res)
	if res["status"] != "fail" {
		t.Fatalf("expected fail, got %v (score %v)", res["status"], res["score"])
	}
}

func TestPostureAuthRequired(t *testing.T) {
	body := `{"org_id":"` + orgA + `","signals":{}}`
	rr := httptest.NewRecorder()
	srv().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/posture", strings.NewReader(body)))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestPostureWrongOrgRejected(t *testing.T) {
	body := `{"org_id":"` + orgA + `","signals":{}}`
	req := httptest.NewRequest(http.MethodPost, "/v1/posture", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok(orgB, time.Minute))
	rr := httptest.NewRecorder()
	srv().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestGeoIPPrivate(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/geoip?org_id="+orgA+"&ip=192.168.1.5", nil)
	req.Header.Set("Authorization", "Bearer "+tok(orgA, time.Minute))
	rr := httptest.NewRecorder()
	srv().ServeHTTP(rr, req)
	var res map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &res)
	if res["is_private"] != true {
		t.Fatalf("expected private, got %v", res)
	}
}
