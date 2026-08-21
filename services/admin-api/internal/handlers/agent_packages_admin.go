package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Superadmin-facing agent-package endpoints — read/manage the same manifest
// and package directory UploadAgentPackage/AgentVersion (agent_packages.go)
// already serve, but gated on a superadmin session (middleware.SuperAdminOnly)
// instead of the CI-only shared bearer token, and paired with fleet-adoption
// data pulled from the devices table so a human can actually decide whether a
// rollout is safe to push or worth rolling back.

type AgentPackageAdminHandler struct {
	db *gorm.DB
}

func NewAgentPackageAdminHandler(db *gorm.DB) *AgentPackageAdminHandler {
	return &AgentPackageAdminHandler{db: db}
}

// filenamePlatformVersion parses the (platform, version) pair out of a
// filename produced by packaging/{macos,windows,linux}/build.sh — the CI
// workflow's own naming convention, not something this handler invents.
var packageFilenamePatterns = []struct {
	platform string
	re       *regexp.Regexp
}{
	{"macos", regexp.MustCompile(`^aavishield-agent-(.+)\.pkg$`)},
	{"windows", regexp.MustCompile(`^aavishield-agent-(.+)\.msi$`)},
	{"linux", regexp.MustCompile(`^aavishield-agent-(.+)-(?:amd64|arm64)\.deb$`)},
}

func filenamePlatformVersion(name string) (platform, version string, ok bool) {
	for _, p := range packageFilenamePatterns {
		if m := p.re.FindStringSubmatch(name); m != nil {
			return p.platform, m[1], true
		}
	}
	return "", "", false
}

// Manifest handles GET /superadmin/agent-packages — the currently published
// version per platform (same data AgentVersion computes for a polling agent,
// minus device auth) plus how the fleet's actually-reported agent_version
// values are distributed, so "did the rollout actually land" is answerable
// without shelling into Postgres.
func (h *AgentPackageAdminHandler) Manifest(c *gin.Context) {
	manifest, err := readManifest()
	current := map[string]any{}
	if err == nil && manifest.Version != "" {
		base := strings.TrimRight(adminAPIURL(c), "/")
		artifacts := map[string]any{}
		for platform, name := range manifest.Artifacts {
			if name == "" || name != filepath.Base(name) {
				continue
			}
			path := filepath.Join(agentPackageDir(), name)
			sum, size, err := fileSHA256(path)
			if err != nil {
				continue
			}
			modTime := ""
			if st, statErr := os.Stat(path); statErr == nil {
				modTime = st.ModTime().UTC().Format("2006-01-02T15:04:05Z")
			}
			artifacts[platform] = gin.H{
				"filename":     name,
				"url":          base + "/agent/packages/" + name,
				"sha256":       sum,
				"size":         size,
				"published_at": modTime,
			}
		}
		current["version"] = manifest.Version
		current["artifacts"] = artifacts
	}

	type versionCount struct {
		AgentVersion string `json:"agent_version"`
		Count        int64  `json:"count"`
	}
	var byVersion []versionCount
	h.db.Table("devices").
		Select("COALESCE(NULLIF(agent_version, ''), 'unknown') as agent_version, count(*) as count").
		Group("agent_version").
		Order("count DESC").
		Scan(&byVersion)

	type platformCount struct {
		OSType string `json:"os_type"`
		Count  int64  `json:"count"`
	}
	var byPlatform []platformCount
	h.db.Table("devices").
		Select("COALESCE(NULLIF(os_type, ''), 'unknown') as os_type, count(*) as count").
		Group("os_type").
		Order("count DESC").
		Scan(&byPlatform)

	var totalDevices int64
	h.db.Table("devices").Count(&totalDevices)

	var upToDate int64
	if v, ok := current["version"].(string); ok && v != "" {
		h.db.Table("devices").Where("agent_version = ?", v).Count(&upToDate)
	}

	c.JSON(http.StatusOK, gin.H{
		"current": current,
		"fleet": gin.H{
			"total_devices": totalDevices,
			"up_to_date":    upToDate,
			"by_version":    byVersion,
			"by_platform":   byPlatform,
		},
	})
}

// History handles GET /superadmin/agent-packages/history — every package
// file still sitting in AGENT_PACKAGE_DIR, not just the one manifest.json
// currently points at. Upload never deletes the previous file for a
// platform (only the manifest pointer moves), so this is what makes
// rollback possible: the old bytes are still there to point back at.
func (h *AgentPackageAdminHandler) History(c *gin.Context) {
	dir := agentPackageDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"packages": []any{}})
		return
	}

	manifest, _ := readManifest()

	type pkgEntry struct {
		Platform string `json:"platform"`
		Filename string `json:"filename"`
		Version  string `json:"version"`
		Size     int64  `json:"size"`
		SHA256   string `json:"sha256"`
		ModTime  string `json:"modified_at"`
		Active   bool   `json:"active"`
	}
	var packages []pkgEntry
	for _, e := range entries {
		if e.IsDir() || e.Name() == "manifest.json" {
			continue
		}
		platform, version, ok := filenamePlatformVersion(e.Name())
		if !ok {
			continue // e.g. the portable .tar.gz — not an installable artifact for any platform's rollback UI
		}
		path := filepath.Join(dir, e.Name())
		sum, size, err := fileSHA256(path)
		if err != nil {
			continue
		}
		st, err := os.Stat(path)
		modTime := ""
		if err == nil {
			modTime = st.ModTime().UTC().Format("2006-01-02T15:04:05Z")
		}
		packages = append(packages, pkgEntry{
			Platform: platform,
			Filename: e.Name(),
			Version:  version,
			Size:     size,
			SHA256:   sum,
			ModTime:  modTime,
			Active:   manifest.Artifacts[platform] == e.Name(),
		})
	}

	sort.Slice(packages, func(i, j int) bool {
		if packages[i].Platform != packages[j].Platform {
			return packages[i].Platform < packages[j].Platform
		}
		return packages[i].ModTime > packages[j].ModTime
	})

	c.JSON(http.StatusOK, gin.H{"packages": packages})
}

// Upload handles POST /superadmin/agent-packages — the same publish
// operation CI's `manifest` job performs over the CI-only bearer token, but
// reachable from the dashboard by a signed-in superadmin for an out-of-band
// hotfix push without needing that token.
func (h *AgentPackageAdminHandler) Upload(c *gin.Context) {
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

// Rollback handles POST /superadmin/agent-packages/rollback — repoints the
// manifest at an already-uploaded file (from History) instead of accepting
// new bytes. No new package is written; this only changes which existing
// file `/internal/agent/version` advertises next poll.
func (h *AgentPackageAdminHandler) Rollback(c *gin.Context) {
	var req struct {
		Platform string `json:"platform"`
		Filename string `json:"filename"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || !validPlatforms[req.Platform] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "platform and filename are required"})
		return
	}
	if req.Filename == "" || req.Filename != filepath.Base(req.Filename) || strings.Contains(req.Filename, "..") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid filename"})
		return
	}
	platform, version, ok := filenamePlatformVersion(req.Filename)
	if !ok || platform != req.Platform {
		c.JSON(http.StatusBadRequest, gin.H{"error": "filename does not match the requested platform"})
		return
	}
	path := filepath.Join(agentPackageDir(), req.Filename)
	if _, err := os.Stat(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "package file not found on disk"})
		return
	}

	manifestMu.Lock()
	defer manifestMu.Unlock()

	manifest, _ := readManifest()
	if manifest.Artifacts == nil {
		manifest.Artifacts = map[string]string{}
	}
	manifest.Artifacts[req.Platform] = req.Filename
	manifest.Version = version
	if err := writeManifest(manifest); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not write manifest"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "rolled back", "platform": req.Platform, "version": version, "filename": req.Filename})
}
