package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/models"
)

// What an expired self-serve company may still change: its plan and payment,
// its demo booking, support tickets, and report exports (reads that happen
// to be POSTs). Paths are relative to /api/v1.
var expiredAllowedPrefixes = []string{"/billing", "/demo-booking", "/tickets", "/reports", "/me"}

const orgStatusTTL = 20 * time.Second

type cachedStatus struct {
	status models.OrgStatus
	at     time.Time
}

var (
	orgStatusMu    sync.Mutex
	orgStatusCache = map[string]cachedStatus{}
)

// ForgetOrgStatus drops the cached status so a payment unlocks the console at
// once rather than after the cache expires.
func ForgetOrgStatus(orgID string) {
	orgStatusMu.Lock()
	delete(orgStatusCache, orgID)
	orgStatusMu.Unlock()
}

func orgStatus(db *gorm.DB, orgID string) models.OrgStatus {
	orgStatusMu.Lock()
	if c, ok := orgStatusCache[orgID]; ok && time.Since(c.at) < orgStatusTTL {
		orgStatusMu.Unlock()
		return c.status
	}
	orgStatusMu.Unlock()

	var org models.Organization
	if err := db.Select("id", "status").First(&org, "id = ?", orgID).Error; err != nil {
		return "" // unknown org: let the handler answer
	}
	orgStatusMu.Lock()
	orgStatusCache[orgID] = cachedStatus{status: org.Status, at: time.Now()}
	orgStatusMu.Unlock()
	return org.Status
}

// ExpiredBlocks decides whether a request to an expired org is refused:
// reads always pass, superadmins always pass, and writes pass only under
// expiredAllowedPrefixes.
func ExpiredBlocks(status models.OrgStatus, method, fullPath, role string) bool {
	if status != models.OrgStatusExpired || role == string(models.RoleSuperAdmin) {
		return false
	}
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	path := strings.TrimPrefix(fullPath, "/api/v1")
	for _, p := range expiredAllowedPrefixes {
		if path == p || strings.HasPrefix(path, p+"/") {
			return false
		}
	}
	return true
}

// ExpiredOrgGate makes the console read-only for a self-serve company whose
// trial or paid period ended. Runs after SetScopedOrgFromJWT. Refusals use
// 402 with code "trial_expired" so the console can show its plan picker.
func ExpiredOrgGate(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead || c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		orgID := GetScopedOrgID(c)
		if orgID == "" {
			c.Next()
			return
		}
		raw, _ := c.Get(ContextKeyRole)
		role, _ := raw.(models.UserRole)
		if ExpiredBlocks(orgStatus(db, orgID), c.Request.Method, c.FullPath(), string(role)) {
			c.AbortWithStatusJSON(http.StatusPaymentRequired, gin.H{
				"error": "Your free trial has ended, so the console is read-only. Choose a plan to make changes again. Your devices are still protected.",
				"code":  "trial_expired",
			})
			return
		}
		c.Next()
	}
}
