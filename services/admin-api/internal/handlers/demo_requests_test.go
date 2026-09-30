package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func postDemo(t *testing.T, secretHeader, body string) int {
	t.Helper()
	h := &DemoRequestHandler{db: nil} // every case below returns before touching the DB
	r := gin.New()
	r.POST("/x", h.Submit)
	req := httptest.NewRequest(http.MethodPost, "/x", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if secretHeader != "" {
		req.Header.Set("X-Internal-Secret", secretHeader)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

func TestDemoSubmitFailsClosedWithoutSecret(t *testing.T) {
	t.Setenv("INTERNAL_API_SECRET", "")
	if got := postDemo(t, "", `{}`); got != http.StatusUnauthorized {
		t.Fatalf("unset secret: got %d, want 401", got)
	}
	if got := postDemo(t, "anything", `{}`); got != http.StatusUnauthorized {
		t.Fatalf("unset secret with header: got %d, want 401", got)
	}
}

func TestDemoSubmitRejectsWrongSecret(t *testing.T) {
	t.Setenv("INTERNAL_API_SECRET", "s3cret")
	if got := postDemo(t, "nope", `{}`); got != http.StatusUnauthorized {
		t.Fatalf("wrong secret: got %d, want 401", got)
	}
}

func TestDemoSubmitValidates(t *testing.T) {
	t.Setenv("INTERNAL_API_SECRET", "s3cret")
	cases := map[string]string{
		"missing company":    `{"name":"Ananya","email":"a@b.co"}`,
		"missing name":       `{"company":"Acme","email":"a@b.co"}`,
		"bad email":          `{"name":"Ananya","company":"Acme","email":"not-an-email"}`,
		"display-name email": `{"name":"Ananya","company":"Acme","email":"Ananya <a@b.co>"}`,
	}
	for name, body := range cases {
		if got := postDemo(t, "s3cret", body); got != http.StatusUnprocessableEntity {
			t.Errorf("%s: got %d, want 422", name, got)
		}
	}
	if got := postDemo(t, "s3cret", `not json`); got != http.StatusBadRequest {
		t.Errorf("bad json: got %d, want 400", got)
	}
}
