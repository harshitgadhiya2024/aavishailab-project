package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aavishield/shadowit-service/internal/auth"
	"github.com/aavishield/shadowit-service/internal/catalog"
	"github.com/aavishield/shadowit-service/internal/config"
)

const (
	secret = "test-shadow-secret"
	orgA   = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	orgB   = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
)

func srv() http.Handler {
	return New(config.Config{ServiceSecret: secret, RequireAuth: true}, catalog.New()).Handler()
}
func tok(org string, ttl time.Duration) string { return auth.Mint(org, secret, ttl) }

func TestHealth(t *testing.T) {
	rr := httptest.NewRecorder()
	srv().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("health %d", rr.Code)
	}
}

func TestClassifyBatch(t *testing.T) {
	body := `{"org_id":"` + orgA + `","domains":["api.dropbox.com","unknown-tool.example","chat.openai.com"]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/classify", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok(orgA, time.Minute))
	rr := httptest.NewRecorder()
	srv().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var out struct{ Results []catalog.Result }
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	if len(out.Results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(out.Results))
	}
	if !out.Results[0].Matched || out.Results[0].App != "Dropbox" {
		t.Fatalf("dropbox subdomain should match: %+v", out.Results[0])
	}
	if out.Results[1].Matched {
		t.Fatalf("unknown should not match: %+v", out.Results[1])
	}
	if out.Results[2].Category != "ai_tools" {
		t.Fatalf("openai should be ai_tools: %+v", out.Results[2])
	}
}

func TestClassifyAuthRequired(t *testing.T) {
	body := `{"org_id":"` + orgA + `","domains":["dropbox.com"]}`
	rr := httptest.NewRecorder()
	srv().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/v1/classify", strings.NewReader(body)))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestClassifyWrongOrgRejected(t *testing.T) {
	body := `{"org_id":"` + orgA + `","domains":["dropbox.com"]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/classify", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok(orgB, time.Minute))
	rr := httptest.NewRecorder()
	srv().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}
