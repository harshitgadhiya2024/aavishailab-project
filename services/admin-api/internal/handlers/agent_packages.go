package handlers

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Native agent packages (.pkg / .msi / .deb) are built in CI and dropped into
// AGENT_PACKAGE_DIR alongside a manifest.json written by the build scripts:
//
//	{"version": "1.2.0", "artifacts": {"macos": "aavishield-agent-1.2.0.pkg", ...}}
//
// The manifest supplies the version and filenames; checksums are always
// computed from the bytes on disk rather than trusted from the manifest, so a
// stale or hand-edited sha can never send an agent a hash that doesn't match
// what it is about to download.

const defaultPackageDir = "/app/agent-packages"

type packageManifest struct {
	Version   string            `json:"version"`
	Artifacts map[string]string `json:"artifacts"`
}

type artifactInfo struct {
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

func agentPackageDir() string {
	if d := os.Getenv("AGENT_PACKAGE_DIR"); d != "" {
		return d
	}
	return defaultPackageDir
}

// checksum cache keyed by path, invalidated when the file's mtime or size moves.
var (
	sumMu    sync.Mutex
	sumCache = map[string]struct {
		mod  time.Time
		size int64
		sum  string
	}{}
)

func fileSHA256(path string) (string, int64, error) {
	st, err := os.Stat(path)
	if err != nil {
		return "", 0, err
	}

	sumMu.Lock()
	if hit, ok := sumCache[path]; ok && hit.mod.Equal(st.ModTime()) && hit.size == st.Size() {
		sumMu.Unlock()
		return hit.sum, st.Size(), nil
	}
	sumMu.Unlock()

	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", 0, err
	}
	sum := hex.EncodeToString(h.Sum(nil))

	sumMu.Lock()
	sumCache[path] = struct {
		mod  time.Time
		size int64
		sum  string
	}{st.ModTime(), st.Size(), sum}
	sumMu.Unlock()

	return sum, st.Size(), nil
}

func readManifest() (packageManifest, error) {
	var m packageManifest
	data, err := os.ReadFile(filepath.Join(agentPackageDir(), "manifest.json"))
	if err != nil {
		return m, err
	}
	err = json.Unmarshal(data, &m)
	return m, err
}

func writeManifest(m packageManifest) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(agentPackageDir(), "manifest.json"), data, 0o644)
}

// manifestMu serializes manifest read-modify-write so two CI jobs publishing
// different platforms for the same release (e.g. macOS and Windows finishing
// within seconds of each other) merge instead of one clobbering the other.
// Also guards the superadmin upload/rollback paths in agent_packages_admin.go
// — every writer of manifest.json goes through this one lock.
var manifestMu sync.Mutex

// publishPackageFile saves an uploaded package under agentPackageDir and
// merges it into manifest.json — the shared core of both the CI-token
// upload path (UploadAgentPackage below) and the superadmin dashboard's
// upload path (AgentPackageAdminHandler.Upload).
func publishPackageFile(c *gin.Context, fileHeader *multipart.FileHeader, platform, version, name string) error {
	dir := agentPackageDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return errors.New("could not prepare package directory")
	}

	manifestMu.Lock()
	defer manifestMu.Unlock()

	if err := c.SaveUploadedFile(fileHeader, filepath.Join(dir, name)); err != nil {
		return errors.New("could not save package")
	}

	manifest, _ := readManifest() // a missing/corrupt manifest just starts fresh
	if manifest.Artifacts == nil {
		manifest.Artifacts = map[string]string{}
	}
	manifest.Version = version
	manifest.Artifacts[platform] = name

	if err := writeManifest(manifest); err != nil {
		return errors.New("could not write manifest")
	}
	return nil
}

var validPlatforms = map[string]bool{"macos": true, "windows": true, "linux": true}

// UploadAgentPackage handles POST /internal/admin/agent-packages — how the
// CI workflow publishes a package this server cannot build itself (pkgbuild
// and WiX are macOS/Windows-only tools). Auth is a single shared bearer
// token, not the employee or per-device agent auth used elsewhere in this
// file, since the caller here is a CI runner with neither identity.
//
// multipart form fields: platform=macos|windows|linux, version=1.4.0, file=<binary>
func UploadAgentPackage(c *gin.Context) {
	expected := os.Getenv("AGENT_PACKAGE_UPLOAD_TOKEN")
	if expected == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	got := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	platform := c.PostForm("platform")
	if !validPlatforms[platform] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "platform must be macos, windows, or linux"})
		return
	}
	version := c.PostForm("version")
	if version == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "version is required"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	name := fileHeader.Filename
	if name == "" || name != filepath.Base(name) || strings.Contains(name, "..") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid filename"})
		return
	}

	if err := publishPackageFile(c, fileHeader, platform, version, name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "published", "platform": platform, "version": version, "filename": name})
}

// AgentVersion handles GET /internal/agent/version — the auto-updater's poll.
// Returns 204 when no packages are published, which the agent treats as
// "nothing to do" rather than an error.
func (h *AgentHandler) AgentVersion(c *gin.Context) {
	deviceID, _, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	manifest, err := readManifest()
	if err != nil || manifest.Version == "" {
		c.Status(http.StatusNoContent)
		return
	}

	base := strings.TrimRight(adminAPIURL(c), "/")
	artifacts := map[string]artifactInfo{}
	for platform, name := range manifest.Artifacts {
		// Reject anything that would escape the package directory.
		if name == "" || name != filepath.Base(name) {
			continue
		}
		sum, size, err := fileSHA256(filepath.Join(agentPackageDir(), name))
		if err != nil {
			continue // listed but not published yet — omit rather than advertise a broken URL
		}
		artifacts[platform] = artifactInfo{
			URL:    base + "/agent/packages/" + name,
			SHA256: sum,
			Size:   size,
		}
	}

	if len(artifacts) == 0 {
		c.Status(http.StatusNoContent)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"version":   manifest.Version,
		"artifacts": artifacts,
	})
}

// NativePackageFor returns the published package for a platform key
// ("macos" / "windows" / "linux"), or ok=false when nothing is published yet.
// Used by the employee portal to decide whether to offer the native installer
// or fall back to the script.
func NativePackageFor(c *gin.Context, platform string) (name, url, version string, size int64, ok bool) {
	manifest, err := readManifest()
	if err != nil || manifest.Version == "" {
		return "", "", "", 0, false
	}
	name = manifest.Artifacts[platform]
	if name == "" || name != filepath.Base(name) {
		return "", "", "", 0, false
	}
	_, size, err = fileSHA256(filepath.Join(agentPackageDir(), name))
	if err != nil {
		return "", "", "", 0, false
	}
	url = strings.TrimRight(adminAPIURL(c), "/") + "/agent/packages/" + name
	return name, url, manifest.Version, size, true
}

// ServeAgentPackage handles GET /agent/packages/:file — public, because the
// download runs from installers and updaters that may not hold agent
// credentials yet. The bytes are signed build artifacts, and the updater
// verifies the SHA-256 it got from the authenticated version endpoint before
// executing anything.
func ServeAgentPackage(c *gin.Context) {
	name := c.Param("file")
	if name == "" || name != filepath.Base(name) || strings.Contains(name, "..") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid package name"})
		return
	}

	path := filepath.Join(agentPackageDir(), name)
	if _, err := os.Stat(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "package not found"})
		return
	}

	c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
	c.File(path)
}
