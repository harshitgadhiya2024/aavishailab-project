package aiclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnabled(t *testing.T) {
	t.Setenv("AI_SERVICE_URL", "")
	if Enabled() {
		t.Fatal("expected disabled with no URL configured")
	}
	t.Setenv("AI_SERVICE_URL", "http://ai-service:6002")
	if !Enabled() {
		t.Fatal("expected enabled once URL is set")
	}
}

func TestClassifyImage_ParsesVerdict(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body classifyRequest
		json.NewDecoder(r.Body).Decode(&body)
		if body.OrgID != "org1" {
			t.Errorf("unexpected org_id: %s", body.OrgID)
		}
		json.NewEncoder(w).Encode(VisionVerdict{Sensitive: true, DocType: "aadhaar_card", Confidence: 90})
	}))
	defer srv.Close()
	t.Setenv("AI_SERVICE_URL", srv.URL)

	v, err := ClassifyImage(context.Background(), "org1", "aGVsbG8=", "image/png")
	if err != nil {
		t.Fatalf("ClassifyImage: %v", err)
	}
	if !v.Sensitive || v.DocType != "aadhaar_card" || v.Confidence != 90 {
		t.Fatalf("unexpected verdict: %+v", v)
	}
}

func TestClassifyImage_NonOKStatusIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	t.Setenv("AI_SERVICE_URL", srv.URL)

	_, err := ClassifyImage(context.Background(), "org1", "aGVsbG8=", "image/png")
	if err == nil {
		t.Fatal("expected an error for a non-200 response")
	}
}
