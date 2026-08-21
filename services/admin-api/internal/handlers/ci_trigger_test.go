package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// stubGitHub stands in for api.github.com, recording the request it
// receives and replying with the given status/body — lets tests verify the
// dispatch call shape (method, path, auth header, JSON body) without
// hitting the real GitHub API.
func stubGitHub(t *testing.T, status int, body string, capture *capturedRequest) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if capture != nil {
			capture.method = r.Method
			capture.path = r.URL.Path + "?" + r.URL.RawQuery
			capture.auth = r.Header.Get("Authorization")
			buf, _ := io.ReadAll(r.Body)
			capture.body = string(buf)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	t.Setenv("GITHUB_API_BASE_URL", srv.URL)
	t.Setenv("GITHUB_REPOSITORY", "aavishield/delsecure")
	t.Setenv("GITHUB_ACTIONS_PAT", "ghp_test_token")
	return srv
}

type capturedRequest struct {
	method, path, auth, body string
}

func TestGithubConfiguredFalseWhenEnvUnset(t *testing.T) {
	t.Setenv("GITHUB_REPOSITORY", "")
	t.Setenv("GITHUB_ACTIONS_PAT", "")
	if _, _, ok := githubConfigured(); ok {
		t.Error("githubConfigured() = true, want false with both env vars unset")
	}
}

// TriggerBuild must fail closed — a superadmin session alone isn't enough
// to fire a CI run against nothing, it needs the repo actually configured.
func TestTriggerBuildNotConfigured(t *testing.T) {
	t.Setenv("GITHUB_REPOSITORY", "")
	t.Setenv("GITHUB_ACTIONS_PAT", "")
	h := NewCITriggerHandler()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"version":"1.6.0"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.TriggerBuild(c)

	if w.Code != http.StatusNotImplemented {
		t.Errorf("status = %d, want 501 when GitHub isn't configured", w.Code)
	}
}

// A workflow_dispatch call must hit exactly the endpoint/ref/inputs the
// "Run workflow" button would — this is what proves the dashboard button
// does the same thing a human clicking through the Actions tab does.
func TestTriggerBuildSendsCorrectDispatch(t *testing.T) {
	var cap capturedRequest
	stubGitHub(t, http.StatusNoContent, "", &cap)
	h := NewCITriggerHandler()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"version":"1.6.0"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.TriggerBuild(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	if cap.method != http.MethodPost {
		t.Errorf("method = %q, want POST", cap.method)
	}
	if !strings.Contains(cap.path, "/repos/aavishield/delsecure/actions/workflows/agent-packages.yml/dispatches") {
		t.Errorf("path = %q, doesn't hit the agent-packages workflow's dispatches endpoint", cap.path)
	}
	if cap.auth != "Bearer ghp_test_token" {
		t.Errorf("auth header = %q, want Bearer ghp_test_token", cap.auth)
	}
	var sent struct {
		Ref    string            `json:"ref"`
		Inputs map[string]string `json:"inputs"`
	}
	if err := json.Unmarshal([]byte(cap.body), &sent); err != nil {
		t.Fatalf("could not decode dispatched body: %v (%q)", err, cap.body)
	}
	if sent.Ref != "main" {
		t.Errorf("ref = %q, want main (the default when not specified)", sent.Ref)
	}
	if sent.Inputs["version"] != "1.6.0" {
		t.Errorf("inputs.version = %q, want 1.6.0", sent.Inputs["version"])
	}
}

func TestTriggerBuildRejectsMissingVersion(t *testing.T) {
	stubGitHub(t, http.StatusNoContent, "", nil)
	h := NewCITriggerHandler()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.TriggerBuild(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 when version is missing", w.Code)
	}
}

// GitHub rejecting the dispatch (bad token, workflow doesn't exist, wrong
// ref) must surface as a clear error, not a false "triggered" success.
func TestTriggerBuildSurfacesGithubRejection(t *testing.T) {
	stubGitHub(t, http.StatusUnprocessableEntity, `{"message":"Workflow does not have workflow_dispatch trigger"}`, nil)
	h := NewCITriggerHandler()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"version":"1.6.0"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.TriggerBuild(c)

	if w.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502 when GitHub itself rejects the dispatch", w.Code)
	}
}

func TestBuildStatusNotConfiguredReturnsEmptyNotError(t *testing.T) {
	t.Setenv("GITHUB_REPOSITORY", "")
	t.Setenv("GITHUB_ACTIONS_PAT", "")
	h := NewCITriggerHandler()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/x", nil)
	h.BuildStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (unconfigured is not an error, just nothing to show)", w.Code)
	}
	var resp struct {
		Configured bool `json:"configured"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Configured {
		t.Error("configured = true, want false")
	}
}

func TestBuildStatusParsesRuns(t *testing.T) {
	stubGitHub(t, http.StatusOK, `{"workflow_runs":[
		{"id":123,"status":"completed","conclusion":"success","head_branch":"main","display_title":"Agent packages","created_at":"2026-08-20T00:00:00Z","updated_at":"2026-08-20T00:05:00Z","html_url":"https://github.com/aavishield/delsecure/actions/runs/123"}
	]}`, nil)
	h := NewCITriggerHandler()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/x", nil)
	h.BuildStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Configured bool             `json:"configured"`
		Runs       []workflowRunOut `json:"runs"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Configured || len(resp.Runs) != 1 {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if resp.Runs[0].Conclusion != "success" || resp.Runs[0].ID != 123 {
		t.Errorf("run parsed incorrectly: %+v", resp.Runs[0])
	}
}
