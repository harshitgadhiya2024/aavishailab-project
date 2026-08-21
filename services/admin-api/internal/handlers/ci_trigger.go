package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Lets a superadmin kick off the "Agent packages" GitHub Actions workflow
// (.github/workflows/agent-packages.yml — builds and publishes native
// installers for all three platforms) straight from the dashboard, instead
// of the repo's Actions tab. Same workflow_dispatch trigger the "Run
// workflow" button fires, called over GitHub's REST API with a repo-scoped
// PAT that never leaves this server or reaches the browser.

const agentPackagesWorkflowFile = "agent-packages.yml"

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
// dispatches the workflow with the version the operator wants built. CI
// itself decides what "1.6.0" means for each platform's filename; this
// endpoint only starts the run and hands back its acceptance, not a
// finished build — see BuildStatus for polling progress.
func (h *CITriggerHandler) TriggerBuild(c *gin.Context) {
	var in struct {
		Version string `json:"version" binding:"required"`
		Ref     string `json:"ref"`
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
	ref := strings.TrimSpace(in.Ref)
	if ref == "" {
		ref = "main"
	}

	if _, _, ok := githubConfigured(); !ok {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "GitHub Actions trigger is not configured — set GITHUB_REPOSITORY and GITHUB_ACTIONS_PAT"})
		return
	}

	resp, err := h.githubRequest(http.MethodPost, "/actions/workflows/"+agentPackagesWorkflowFile+"/dispatches", gin.H{
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

	c.JSON(http.StatusOK, gin.H{"status": "triggered", "version": version, "ref": ref})
}

type workflowRunOut struct {
	ID         int64  `json:"id"`
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

	resp, err := h.githubRequest(http.MethodGet, "/actions/workflows/"+agentPackagesWorkflowFile+"/runs?per_page=5", nil)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not reach GitHub"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		c.JSON(http.StatusBadGateway, gin.H{"error": "GitHub rejected the request", "detail": string(body)})
		return
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
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not parse GitHub response"})
		return
	}

	runs := make([]workflowRunOut, 0, len(parsed.WorkflowRuns))
	for _, r := range parsed.WorkflowRuns {
		runs = append(runs, workflowRunOut{
			ID: r.ID, Status: r.Status, Conclusion: r.Conclusion,
			Ref: r.HeadBranch, Title: r.DisplayTitle,
			CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, URL: r.HTMLURL,
		})
	}
	c.JSON(http.StatusOK, gin.H{"configured": true, "runs": runs})
}
