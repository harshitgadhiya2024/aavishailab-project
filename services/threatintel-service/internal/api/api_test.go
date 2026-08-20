package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aavishield/threatintel-service/internal/auth"
	"github.com/aavishield/threatintel-service/internal/config"
	"github.com/aavishield/threatintel-service/internal/scoring"
	"github.com/aavishield/threatintel-service/internal/store"
)

const (
	secret = "test-ti-secret"
	orgA   = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	orgB   = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
)

func testServer() http.Handler {
	cfg := config.Config{ServiceSecret: secret, RequireAuth: true, BlockThreshold: 80, AlertThreshold: 50}
	s := store.New()
	s.SetDomain("evil-malware.com", store.Entry{Source: "urlhaus", Category: "malware"})
	return New(cfg, s).Handler()
}

func tok(org string, ttl time.Duration) string { return auth.Mint(org, secret, ttl) }

func TestHealth(t *testing.T) {
	rr := httptest.NewRecorder()
	testServer().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("health status %d", rr.Code)
	}
}

func TestScoreDomainBlock(t *testing.T) {
	body := `{"org_id":"` + orgA + `","indicator":"evil-malware.com","kind":"domain"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/score", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok(orgA, time.Minute))
	rr := httptest.NewRecorder()
	testServer().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var res scoring.Result
	_ = json.Unmarshal(rr.Body.Bytes(), &res)
	if res.Band != "block" || !res.ThreatIntelHit {
		t.Fatalf("expected block hit, got %+v", res)
	}
}

func TestLookupClean(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/lookup?org_id="+orgA+"&domain=example.com", nil)
	req.Header.Set("Authorization", "Bearer "+tok(orgA, time.Minute))
	rr := httptest.NewRecorder()
	testServer().ServeHTTP(rr, req)
	var res scoring.Result
	_ = json.Unmarshal(rr.Body.Bytes(), &res)
	if res.Band != "allow" {
		t.Fatalf("expected allow, got %s", res.Band)
	}
}

func TestMissingTokenRejected(t *testing.T) {
	body := `{"org_id":"` + orgA + `","indicator":"evil-malware.com"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/score", strings.NewReader(body))
	rr := httptest.NewRecorder()
	testServer().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestWrongOrgRejected(t *testing.T) {
	body := `{"org_id":"` + orgA + `","indicator":"evil-malware.com"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/score", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok(orgB, time.Minute)) // token for a different org
	rr := httptest.NewRecorder()
	testServer().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	body := `{"org_id":"` + orgA + `","indicator":"evil-malware.com"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/score", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok(orgA, -time.Minute))
	rr := httptest.NewRecorder()
	testServer().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}
