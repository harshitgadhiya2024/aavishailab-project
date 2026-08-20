package metrics

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMiddlewareRecordsRequestsByRouteTemplate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Middleware())
	r.GET("/api/v1/employees/:id", func(c *gin.Context) { c.Status(200) })
	r.GET("/metrics", Handler)

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("GET", "/api/v1/employees/"+string(rune('a'+i)), nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
	}

	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	body := w.Body.String()

	// Cardinality must stay bounded: the route TEMPLATE, not three raw paths.
	if strings.Count(body, `route="/api/v1/employees/:id"`) == 0 {
		t.Fatalf("expected route template in output, got:\n%s", body)
	}
	if !strings.Contains(body, `admin_api_http_requests_total{method="GET",route="/api/v1/employees/:id"} 3`) {
		t.Fatalf("expected count=3 for the templated route, got:\n%s", body)
	}
}

func TestMiddlewareRecordsServerErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Middleware())
	r.GET("/boom", func(c *gin.Context) { c.Status(500) })
	r.GET("/metrics", Handler)

	req := httptest.NewRequest("GET", "/boom", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	req = httptest.NewRequest("GET", "/metrics", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	body := w.Body.String()

	if !strings.Contains(body, `admin_api_http_request_errors_total{method="GET",route="/boom"} 1`) {
		t.Fatalf("expected 1 recorded 5xx error, got:\n%s", body)
	}
}

func TestHandlerOutputIsValidPrometheusTextFormat(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Middleware())
	r.GET("/ping", func(c *gin.Context) { c.Status(200) })
	r.GET("/metrics", Handler)

	req := httptest.NewRequest("GET", "/ping", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	req = httptest.NewRequest("GET", "/metrics", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Regression guard for the exact bug found in the Python services:
	// the body must be plain text, never a JSON-quoted string.
	body := w.Body.String()
	if strings.HasPrefix(strings.TrimSpace(body), `"`) {
		t.Fatalf("metrics body looks JSON-encoded (the Python-service bug), got:\n%s", body)
	}
	if !strings.Contains(body, "# TYPE admin_api_http_requests_total counter") {
		t.Fatalf("missing Prometheus TYPE header, got:\n%s", body)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Fatalf("expected text/plain content-type, got %q", ct)
	}
}
