package handlers

import (
	"context"
	"crypto/subtle"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/aavishield/admin-api/internal/storage"
	"github.com/gin-gonic/gin"
)

// UploadDBBackup handles POST /internal/admin/backup-upload — how
// scripts/backup-db.sh gets a pg_dump onto R2.
//
// It exists because rclone (the obvious tool for this) turned out not to
// work against this account's real R2 bucket — every upload came back
// "403 AccessDenied" against a 2021-era apt package version, while this
// same server's own hand-rolled SigV4 client (storage.r2Backend, already
// proven live for screenshots) uploads to the identical bucket/credentials
// with no issue. Reusing that proven client via a small internal endpoint
// was simpler and more reliable than chasing rclone's exact incompatibility.
//
// Auth is a single shared bearer token, the same shape as
// UploadAgentPackage's (a cron job has no employee/device identity to
// authenticate as either).
func UploadDBBackup(c *gin.Context) {
	expected := os.Getenv("BACKUP_UPLOAD_TOKEN")
	if expected == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	got := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
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

	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read upload"})
		return
	}
	defer f.Close()
	// io.ReadAll, not a single f.Read into a pre-sized buffer: Read is not
	// guaranteed to fill its buffer in one call, and a short read here
	// would silently upload a truncated dump.
	data, err := io.ReadAll(f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read upload"})
		return
	}

	// "db-backups/" here, not "aavishield/db-backups/": SCREENSHOT_R2_PREFIX
	// (already configured for the shared bucket) applies to every key this
	// backend touches, screenshots and this alike — see storage.go's
	// r2Backend.fullKey.
	key := "db-backups/" + name
	if err := storage.New().Put(context.Background(), key, "application/gzip", data); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "uploaded", "filename": name})
}
