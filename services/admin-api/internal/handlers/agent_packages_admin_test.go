package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestFilenamePlatformVersion(t *testing.T) {
	cases := []struct {
		name        string
		wantPlat    string
		wantVersion string
		wantOK      bool
	}{
		{"aavishield-agent-1.5.0.pkg", "macos", "1.5.0", true},
		{"aavishield-agent-1.5.0.msi", "windows", "1.5.0", true},
		{"aavishield-agent-1.5.0-amd64.deb", "linux", "1.5.0", true},
		{"aavishield-agent-1.5.0-arm64.deb", "linux", "1.5.0", true},
		{"aavishield-agent-1.5.0-amd64.tar.gz", "", "", false}, // portable tarball — not a rollback-able installer
		{"manifest.json", "", "", false},
		{"../../etc/passwd", "", "", false},
	}
	for _, tc := range cases {
		platform, version, ok := filenamePlatformVersion(tc.name)
		if ok != tc.wantOK || platform != tc.wantPlat || version != tc.wantVersion {
			t.Errorf("filenamePlatformVersion(%q) = (%q, %q, %v), want (%q, %q, %v)",
				tc.name, platform, version, ok, tc.wantPlat, tc.wantVersion, tc.wantOK)
		}
	}
}

func newAdminHandlerWithTempDir(t *testing.T) (*AgentPackageAdminHandler, string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("AGENT_PACKAGE_DIR", dir)
	return &AgentPackageAdminHandler{db: nil}, dir
}

func writeFile(t *testing.T, dir, name string, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// History must only surface installable artifacts (parseable filenames),
// mark exactly the file the manifest currently points at as active, and
// never choke on the manifest.json/tarball files living in the same dir.
func TestHistoryListsParseableArtifactsAndMarksActive(t *testing.T) {
	h, dir := newAdminHandlerWithTempDir(t)
	writeFile(t, dir, "aavishield-agent-1.4.0-amd64.deb", "old-linux-build")
	writeFile(t, dir, "aavishield-agent-1.5.0-amd64.deb", "new-linux-build")
	writeFile(t, dir, "aavishield-agent-1.5.0-amd64.tar.gz", "portable-tarball")
	writeFile(t, dir, "manifest.json", `{"version":"1.5.0","artifacts":{"linux":"aavishield-agent-1.5.0-amd64.deb"}}`)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/superadmin/agent-packages/history", nil)
	h.History(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Packages []struct {
			Platform string `json:"platform"`
			Filename string `json:"filename"`
			Version  string `json:"version"`
			Active   bool   `json:"active"`
		} `json:"packages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Packages) != 2 {
		t.Fatalf("got %d packages, want 2 (tar.gz and manifest.json must be excluded): %+v", len(resp.Packages), resp.Packages)
	}
	for _, p := range resp.Packages {
		wantActive := p.Filename == "aavishield-agent-1.5.0-amd64.deb"
		if p.Active != wantActive {
			t.Errorf("package %q: active = %v, want %v", p.Filename, p.Active, wantActive)
		}
	}
}

func multipartUploadRequest(t *testing.T, platform, version, filename, content string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("platform", platform)
	_ = mw.WriteField("version", version)
	fw, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write([]byte(content))
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/superadmin/agent-packages", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

// Upload is the superadmin dashboard's hotfix path — it must actually write
// the bytes and merge into manifest.json exactly like the CI-token path
// does, so a rollout pushed from the dashboard is indistinguishable from one
// CI published.
func TestUploadWritesFileAndMergesManifest(t *testing.T) {
	h, dir := newAdminHandlerWithTempDir(t)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = multipartUploadRequest(t, "linux", "1.6.0", "aavishield-agent-1.6.0-amd64.deb", "hotfix-bytes")
	h.Upload(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	got, err := os.ReadFile(filepath.Join(dir, "aavishield-agent-1.6.0-amd64.deb"))
	if err != nil || string(got) != "hotfix-bytes" {
		t.Fatalf("uploaded file not written correctly: %v, %q", err, got)
	}
	manifest, err := readManifest()
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Version != "1.6.0" || manifest.Artifacts["linux"] != "aavishield-agent-1.6.0-amd64.deb" {
		t.Fatalf("manifest not updated: %+v", manifest)
	}
}

func TestUploadRejectsInvalidPlatform(t *testing.T) {
	h, _ := newAdminHandlerWithTempDir(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = multipartUploadRequest(t, "solaris", "1.0.0", "x.bin", "data")
	h.Upload(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for an unrecognized platform", w.Code)
	}
}

// Rollback must never accept a client-declared version: the version comes
// only from parsing the filename of a file that genuinely exists on disk,
// so a rollback can't silently advertise a version string that doesn't
// match the bytes it actually points at.
func TestRollbackRepointsManifestToExistingFile(t *testing.T) {
	h, dir := newAdminHandlerWithTempDir(t)
	writeFile(t, dir, "aavishield-agent-1.4.0-amd64.deb", "old-build")
	writeFile(t, dir, "aavishield-agent-1.5.0-amd64.deb", "new-build")
	writeFile(t, dir, "manifest.json", `{"version":"1.5.0","artifacts":{"linux":"aavishield-agent-1.5.0-amd64.deb"}}`)

	body, _ := json.Marshal(map[string]string{"platform": "linux", "filename": "aavishield-agent-1.4.0-amd64.deb"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/superadmin/agent-packages/rollback", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Rollback(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	manifest, err := readManifest()
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Version != "1.4.0" || manifest.Artifacts["linux"] != "aavishield-agent-1.4.0-amd64.deb" {
		t.Fatalf("rollback did not repoint manifest: %+v", manifest)
	}
}

func TestRollbackRejectsMissingFile(t *testing.T) {
	h, _ := newAdminHandlerWithTempDir(t)
	body, _ := json.Marshal(map[string]string{"platform": "linux", "filename": "aavishield-agent-9.9.9-amd64.deb"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/superadmin/agent-packages/rollback", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Rollback(c)
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for a filename that isn't on disk", w.Code)
	}
}

// A mismatched platform/filename pair (e.g. claiming a .deb is the "macos"
// artifact) must be rejected — otherwise the manifest could end up
// advertising a Linux binary as the macOS download.
func TestRollbackRejectsPlatformFilenameMismatch(t *testing.T) {
	h, dir := newAdminHandlerWithTempDir(t)
	writeFile(t, dir, "aavishield-agent-1.4.0-amd64.deb", "old-build")

	body, _ := json.Marshal(map[string]string{"platform": "macos", "filename": "aavishield-agent-1.4.0-amd64.deb"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/superadmin/agent-packages/rollback", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Rollback(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for a platform/filename mismatch", w.Code)
	}
}
