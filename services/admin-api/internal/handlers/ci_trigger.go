package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Lets a superadmin kick off an agent release workflow straight from the
// dashboard, instead of the repo's Actions tab. Each platform has its own
// workflow (.github/workflows/agent-macos.yml / agent-windows.yml /
// agent-linux.yml) and its own version, so a build is always for exactly
// one platform — a macOS fix never rebuilds or re-signs Windows. Same
// workflow_dispatch trigger the "Run workflow" button fires, called over
// GitHub's REST API with a repo-scoped PAT that never leaves this server or
// reaches the browser.

var agentWorkflowFiles = map[string]string{
	"macos":   "agent-macos.yml",
	"windows": "agent-windows.yml",
	"linux":   "agent-linux.yml",
}

type CITriggerHandler struct {
	http *http.Client
}

func NewCITriggerHandler() *CITriggerHandler {
	return &CITriggerHandler{http: &http.Client{Timeout: 15 * time.Second}}
}

// githubAPIBase is overridable so tests can point it at an httptest server —
// same pattern as SHADOWIT_SERVICE_URL elsewhere in this package.
func githubAPIBase() string {
	if b := os.Getenv("GITHUB_API_BASE_URL"); b != "" {
		return strings.TrimRight(b, "/")
	}
	return "https://api.github.com"
}

// githubConfigured reports whether enough is set to call GitHub at all.
// GITHUB_REPOSITORY follows GitHub Actions' own env var name/shape
// ("owner/repo") since operators setting this up are already used to it.
func githubConfigured() (repo, token string, ok bool) {
	repo = os.Getenv("GITHUB_REPOSITORY")
	token = os.Getenv("GITHUB_ACTIONS_PAT")
	return repo, token, repo != "" && token != ""
}

func (h *CITriggerHandler) githubRequest(method, path string, body any) (*http.Response, error) {
	repo, token, ok := githubConfigured()
	if !ok {
		return nil, fmt.Errorf("github actions trigger not configured")
	}
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, githubAPIBase()+"/repos/"+repo+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return h.http.Do(req)
}

// TriggerBuild handles POST /superadmin/agent-packages/trigger-build —
// dispatches the chosen platform's workflow with the version the operator
// wants built. CI checks that version against that platform's releases;
// this endpoint only starts the run and hands back its acceptance, not a
// finished build — see BuildStatus for polling progress.
func (h *CITriggerHandler) TriggerBuild(c *gin.Context) {
	var in struct {
		Platform string `json:"platform" binding:"required"`
		Version  string `json:"version" binding:"required"`
		Ref      string `json:"ref"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	version := strings.TrimSpace(in.Version)
	if version == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "version is required"})
		return
	}
	workflow, ok := agentWorkflowFiles[in.Platform]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "platform must be macos, windows or linux"})
		return
	}
	ref := strings.TrimSpace(in.Ref)
	if ref == "" {
		ref = "main"
	}

	if _, _, ok := githubConfigured(); !ok {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "GitHub Actions trigger is not configured — set GITHUB_REPOSITORY and GITHUB_ACTIONS_PAT"})
		return
	}

	resp, err := h.githubRequest(http.MethodPost, "/actions/workflows/"+workflow+"/dispatches", gin.H{
		"ref":    ref,
		"inputs": gin.H{"version": version},
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not reach GitHub"})
		return
	}
	defer resp.Body.Close()

	// workflow_dispatch acknowledges with a bare 204 — GitHub doesn't hand
	// back a run ID synchronously, hence BuildStatus polling by workflow
	// rather than by a specific run.
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		c.JSON(http.StatusBadGateway, gin.H{"error": "GitHub rejected the dispatch", "detail": string(body), "github_status": resp.StatusCode})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "triggered", "platform": in.Platform, "version": version, "ref": ref})
}

type workflowRunOut struct {
	ID         int64  `json:"id"`
	Platform   string `json:"platform"`
	Status     string `json:"status"`     // queued | in_progress | completed
	Conclusion string `json:"conclusion"` // success | failure | cancelled | "" while running
	Ref        string `json:"ref"`
	Title      string `json:"title"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
	URL        string `json:"url"`
}

// BuildStatus handles GET /superadmin/agent-packages/build-status — the
// workflow's most recent runs, so the dashboard can show "still running" /
// "succeeded" / "failed" after a trigger instead of sending the operator to
// GitHub's own Actions tab to find out.
func (h *CITriggerHandler) BuildStatus(c *gin.Context) {
	if _, _, ok := githubConfigured(); !ok {
		c.JSON(http.StatusOK, gin.H{"configured": false, "runs": []workflowRunOut{}})
		return
	}

	runs := []workflowRunOut{}
	for platform, workflow := range agentWorkflowFiles {
		got, err := h.workflowRuns(workflow)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		for _, r := range got {
			r.Platform = platform
			runs = append(runs, r)
		}
	}
	sort.Slice(runs, func(i, j int) bool { return runs[i].CreatedAt > runs[j].CreatedAt })
	if len(runs) > 8 {
		runs = runs[:8]
	}
	c.JSON(http.StatusOK, gin.H{"configured": true, "runs": runs})
}

// workflowRuns is one workflow's most recent runs. A workflow GitHub does
// not know yet (404 — e.g. before its file reaches the default branch) has
// no runs rather than being an error.
func (h *CITriggerHandler) workflowRuns(workflow string) ([]workflowRunOut, error) {
	resp, err := h.githubRequest(http.MethodGet, "/actions/workflows/"+workflow+"/runs?per_page=5", nil)
	if err != nil {
		return nil, fmt.Errorf("could not reach GitHub")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("GitHub rejected the request: %s", body)
	}

	var parsed struct {
		WorkflowRuns []struct {
			ID           int64  `json:"id"`
			Status       string `json:"status"`
			Conclusion   string `json:"conclusion"`
			HeadBranch   string `json:"head_branch"`
			DisplayTitle string `json:"display_title"`
			CreatedAt    string `json:"created_at"`
			UpdatedAt    string `json:"updated_at"`
			HTMLURL      string `json:"html_url"`
		} `json:"workflow_runs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("could not parse GitHub response")
	}
	runs := make([]workflowRunOut, 0, len(parsed.WorkflowRuns))
	for _, r := range parsed.WorkflowRuns {
		runs = append(runs, workflowRunOut{
			ID: r.ID, Status: r.Status, Conclusion: r.Conclusion,
			Ref: r.HeadBranch, Title: r.DisplayTitle,
			CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, URL: r.HTMLURL,
		})
	}
	return runs, nil
}
