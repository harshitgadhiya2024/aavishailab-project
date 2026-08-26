package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/auth"
	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type PortalHandler struct {
	db  *gorm.DB
	hub *WebSocketHub
}

func NewPortalHandler(db *gorm.DB, hub *WebSocketHub) *PortalHandler {
	return &PortalHandler{db: db, hub: hub}
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

// portalAuthPayload issues a portal access token plus a refresh token and
// builds the response body every portal auth entry point returns, so login,
// signup, social sign-in and refresh all hand back the same shape — and all
// of them give the client something to refresh with when the 8-hour access
// token runs out.
func (h *PortalHandler) portalAuthPayload(c *gin.Context, emp *models.Employee) (gin.H, error) {
	accessToken, _, err := auth.GeneratePortalToken(emp)
	if err != nil {
		return nil, err
	}

	plainRefresh, hashedRefresh, err := auth.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	rt := models.EmployeeRefreshToken{
		EmployeeID: emp.ID,
		TokenHash:  hashedRefresh,
		ExpiresAt:  auth.RefreshExpiry(),
		IPAddress:  c.ClientIP(),
		DeviceInfo: c.GetHeader("User-Agent"),
	}
	if err := h.db.Create(&rt).Error; err != nil {
		return nil, err
	}

	return gin.H{
		"access_token":  accessToken,
		"refresh_token": plainRefresh,
		"expires_in":    8 * 3600,
		"employee": gin.H{
			"id":           emp.ID,
			"email":        emp.Email,
			"first_name":   emp.FirstName,
			"last_name":    emp.LastName,
			"full_name":    emp.FullName(),
			"department":   emp.Department,
			"job_title":    emp.JobTitle,
			"org_id":       emp.OrgID,
			"device_count": emp.DeviceCount,
		},
	}, nil
}

// Refresh handles POST /api/v1/portal/refresh
// Same rotation-with-grace-window rules as the company-side refresh: the old
// token is retired but keeps working for a minute so parallel requests don't
// knock each other out of the session.
func (h *PortalHandler) Refresh(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashed := auth.HashRefreshToken(req.RefreshToken)

	var rt models.EmployeeRefreshToken
	if err := h.db.Where("token_hash = ? AND expires_at > ?", hashed, time.Now()).
		First(&rt).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired refresh token"})
		return
	}
	if rt.Revoked && !withinRotationGrace(rt.RevokedAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired refresh token"})
		return
	}

	var emp models.Employee
	if err := h.db.Where("id = ? AND status = 'active'", rt.EmployeeID).First(&emp).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Employee account is no longer active"})
		return
	}

	if !rt.Revoked {
		now := time.Now()
		h.db.Model(&rt).Updates(map[string]any{"revoked": true, "revoked_at": now})
	}

	payload, err := h.portalAuthPayload(c, &emp)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	c.JSON(http.StatusOK, payload)
}

// Login handles POST /api/v1/portal/login
func (h *PortalHandler) Login(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var emp models.Employee
	if err := h.db.Where("email = ? AND status = 'active'", req.Email).
		Preload("Team").First(&emp).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	if emp.PortalPasswordHash == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Portal access not set up. Contact your IT administrator."})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(emp.PortalPasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	payload, err := h.portalAuthPayload(c, &emp)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	c.JSON(http.StatusOK, payload)
}

// Signup handles POST /api/v1/portal/signup — activates portal access for an
// employee record that a company admin has already provisioned. Employees
// can't create new employee records themselves; this only lets them set a
// password for the first time using the company code + their listed work email.
func (h *PortalHandler) Signup(c *gin.Context) {
	var req struct {
		CompanyCode string `json:"company_code" binding:"required"`
		Email       string `json:"email" binding:"required,email"`
		Password    string `json:"password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	slug := strings.ToLower(strings.TrimSpace(req.CompanyCode))
	var org models.Organization
	if err := h.db.Where("slug = ?", slug).First(&org).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Unknown company code"})
		return
	}

	var emp models.Employee
	if err := h.db.Where("org_id = ? AND email = ? AND status = 'active'", org.ID, req.Email).
		First(&emp).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No employee record found for this email at this company. Ask your IT administrator to add you first."})
		return
	}

	if emp.PortalPasswordHash != "" {
		c.JSON(http.StatusConflict, gin.H{"error": "This account is already activated. Please sign in instead."})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}
	h.db.Model(&emp).Update("portal_password_hash", string(hashed))

	payload, err := h.portalAuthPayload(c, &emp)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	c.JSON(http.StatusCreated, payload)
}

// ForgotPassword handles POST /api/v1/portal/forgot-password
func (h *PortalHandler) ForgotPassword(c *gin.Context) {
	var req struct {
		CompanyCode string `json:"company_code" binding:"required"`
		Email       string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp := gin.H{"message": "If that account exists, reset instructions have been sent."}

	slug := strings.ToLower(strings.TrimSpace(req.CompanyCode))
	var org models.Organization
	if err := h.db.Where("slug = ?", slug).First(&org).Error; err == nil {
		var emp models.Employee
		if err := h.db.Where("org_id = ? AND email = ? AND status = 'active'", org.ID, req.Email).
			First(&emp).Error; err == nil {
			plain, hashed, genErr := auth.GenerateRefreshToken()
			if genErr == nil {
				h.db.Create(&models.PasswordResetToken{
					EmployeeID: &emp.ID,
					TokenHash:  hashed,
					ExpiresAt:  time.Now().Add(1 * time.Hour),
				})
				if os.Getenv("APP_ENV") != "production" {
					mailer.PasswordReset(emp.Email, emp.FirstName, plain, true)
					if !mailer.Enabled() {
						resp["reset_token"] = plain
						resp["dev_note"] = "SMTP is not configured — this token is only returned outside production."
					}
				}
			}
		}
	}

	c.JSON(http.StatusOK, resp)
}

// ResetPassword handles POST /api/v1/portal/reset-password
func (h *PortalHandler) ResetPassword(c *gin.Context) {
	var req struct {
		Token       string `json:"token" binding:"required"`
		NewPassword string `json:"new_password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashed := auth.HashRefreshToken(req.Token)
	var prt models.PasswordResetToken
	if err := h.db.Where("token_hash = ? AND used = false AND expires_at > ? AND employee_id IS NOT NULL", hashed, time.Now()).
		First(&prt).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid or expired reset link"})
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	h.db.Model(&models.Employee{}).Where("id = ?", *prt.EmployeeID).Update("portal_password_hash", string(newHash))
	h.db.Model(&prt).Update("used", true)

	var resetEmp models.Employee
	if err := h.db.First(&resetEmp, "id = ?", *prt.EmployeeID).Error; err == nil {
		mailer.PasswordChanged(resetEmp.Email, resetEmp.FirstName, true)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Password reset successfully"})
}

// SocialLogin handles POST /api/v1/portal/social — same trust model as the
// company auth.SocialLogin: internal-secret gated, only logs in an employee
// record that a company admin already provisioned.
func (h *PortalHandler) SocialLogin(c *gin.Context) {
	if !validInternalSecret(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	var req struct {
		CompanyCode string `json:"company_code" binding:"required"`
		Email       string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	slug := strings.ToLower(strings.TrimSpace(req.CompanyCode))
	var org models.Organization
	if err := h.db.Where("slug = ?", slug).First(&org).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Unknown company code"})
		return
	}

	var emp models.Employee
	if err := h.db.Where("org_id = ? AND email = ? AND status = 'active'", org.ID, req.Email).
		First(&emp).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No employee record found for this email at this company."})
		return
	}

	payload, err := h.portalAuthPayload(c, &emp)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	c.JSON(http.StatusOK, payload)
}

// Me handles GET /api/v1/portal/me
func (h *PortalHandler) Me(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}

	var devices []models.Device
	h.db.Where("employee_id = ?", emp.ID).Order("last_seen_at DESC").Find(&devices)

	var blockedCount, allowedCount int64
	since := time.Now().AddDate(0, 0, -7)
	h.db.Model(&models.ActivityEvent{}).
		Where("employee_id = ? AND timestamp >= ? AND action = 'blocked'", emp.ID, since).
		Count(&blockedCount)
	h.db.Model(&models.ActivityEvent{}).
		Where("employee_id = ? AND timestamp >= ? AND action = 'allowed'", emp.ID, since).
		Count(&allowedCount)

	c.JSON(http.StatusOK, gin.H{
		"employee": gin.H{
			"id":             emp.ID,
			"email":          emp.Email,
			"first_name":     emp.FirstName,
			"last_name":      emp.LastName,
			"full_name":      emp.FullName(),
			"department":     emp.Department,
			"job_title":      emp.JobTitle,
			"org_id":         emp.OrgID,
			"risk_score":     emp.RiskScore,
			"last_active_at": emp.LastActiveAt,
		},
		"devices": devices,
		"stats_7d": gin.H{
			"blocked": blockedCount,
			"allowed": allowedCount,
		},
	})
}

// ─── Installer Download ───────────────────────────────────────────────────────

// DownloadInstaller handles GET /api/v1/portal/download/:os
// Generates a self-contained installer script with enrollment token baked in.
func (h *PortalHandler) DownloadInstaller(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}
	osType := strings.ToLower(c.Param("os"))

	// Generate enrollment token
	raw := make([]byte, 24)
	rand.Read(raw)
	token := "dse_" + hex.EncodeToString(raw)

	empID := emp.ID
	enrollToken := models.EnrollmentToken{
		OrgID:      emp.OrgID,
		EmployeeID: &empID,
		Token:      token,
		Label:      fmt.Sprintf("Portal download – %s (%s)", emp.FullName(), osType),
		ExpiresAt:  time.Now().Add(2 * time.Hour),
	}
	if err := h.db.Create(&enrollToken).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate installer"})
		return
	}

	adminURL := adminAPIURL(c)
	swgHost := swgEngineHost(c)
	swgPort := swgEnginePort()

	// When a native package exists for this OS, serve the bootstrap instead: it
	// installs a self-contained binary, so the employee needs nothing
	// preinstalled. The Python installers stay as the fallback for any OS whose
	// package hasn't been published yet.
	pkgName, _, _, _, _, hasNative := NativePackageFor(c, osType)

	switch osType {
	case "macos":
		script := buildMacOSInstaller(token, emp.FullName(), adminURL, swgHost, swgPort)
		if hasNative {
			script = buildMacOSBootstrap(token, emp.FullName(), adminURL, pkgName)
		}
		c.Header("Content-Disposition", `attachment; filename="aavishield-install.command"`)
		c.Header("Content-Type", "application/octet-stream")
		c.String(http.StatusOK, script)

	case "windows":
		script := buildWindowsInstaller(token, emp.FullName(), adminURL, swgHost, swgPort)
		if hasNative {
			script = buildWindowsBootstrap(token, emp.FullName(), adminURL, pkgName)
		}
		c.Header("Content-Disposition", `attachment; filename="aavishield-install.bat"`)
		c.Header("Content-Type", "application/octet-stream")
		c.String(http.StatusOK, script)

	case "linux":
		script := buildLinuxInstaller(token, emp.FullName(), adminURL, swgHost, swgPort)
		if hasNative {
			script = buildLinuxBootstrap(token, emp.FullName(), adminURL, pkgName)
		}
		c.Header("Content-Disposition", `attachment; filename="aavishield-install.sh"`)
		c.Header("Content-Type", "application/octet-stream")
		c.String(http.StatusOK, script)

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported OS. Use: macos, windows, linux"})
	}
}

// InstallerInfo handles GET /api/v1/portal/installer-info/:os
//
// Tells the portal whether a signed native package is published for this OS and
// hands back a fresh enrollment token to pair with it. Native packages are
// identical for every employee, so the token travels separately rather than
// being baked into the download the way the script installer does it.
func (h *PortalHandler) InstallerInfo(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}
	osType := strings.ToLower(c.Param("os"))
	if osType != "macos" && osType != "windows" && osType != "linux" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported OS. Use: macos, windows, linux"})
		return
	}

	raw := make([]byte, 24)
	rand.Read(raw)
	token := "dse_" + hex.EncodeToString(raw)

	empID := emp.ID
	expiresAt := time.Now().Add(2 * time.Hour)
	enrollToken := models.EnrollmentToken{
		OrgID:      emp.OrgID,
		EmployeeID: &empID,
		Token:      token,
		Label:      fmt.Sprintf("Portal native installer – %s (%s)", emp.FullName(), osType),
		ExpiresAt:  expiresAt,
	}
	if err := h.db.Create(&enrollToken).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate enrollment token"})
		return
	}

	resp := gin.H{
		"os":         osType,
		"token":      token,
		"admin_url":  adminAPIURL(c),
		"expires_at": expiresAt,
		"native":     nil,
	}
	if name, url, version, sha256sum, size, found := NativePackageFor(c, osType); found {
		resp["native"] = gin.H{
			"filename": name,
			"url":      url,
			"version":  version,
			"size":     size,
			"sha256":   sha256sum,
		}
	}
	c.JSON(http.StatusOK, resp)
}

// EnrollDevice handles POST /api/v1/portal/enroll-device
//
// Backs the first-run enrollment page an installed agent opens when it has no
// credentials yet. The agent cannot authenticate — it has nothing to
// authenticate with, which is the entire problem — so the employee's portal
// session is what proves whose device this is, and the browser carries the
// resulting token the last hop to the agent over loopback.
//
// Short-lived deliberately: it is handed straight to a process already waiting
// for it, so unlike a token somebody has to find time to paste, there is no
// reason for this one to outlive the page that fetched it.
func (h *PortalHandler) EnrollDevice(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}

	raw := make([]byte, 24)
	rand.Read(raw)
	token := "dse_" + hex.EncodeToString(raw)

	empID := emp.ID
	expiresAt := time.Now().Add(10 * time.Minute)
	enrollToken := models.EnrollmentToken{
		OrgID:      emp.OrgID,
		EmployeeID: &empID,
		Token:      token,
		Label:      fmt.Sprintf("First-run enrollment – %s", emp.FullName()),
		ExpiresAt:  expiresAt,
	}
	if err := h.db.Create(&enrollToken).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate enrollment token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"admin_url":  adminAPIURL(c),
		"expires_at": expiresAt,
		"employee":   emp.FullName(),
	})
}

// DownloadUninstaller handles GET /api/v1/portal/uninstall/:os
func (h *PortalHandler) DownloadUninstaller(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}

	// No permission check here any more: removal is gated where it actually
	// happens — the connector asks for a company administrator's password and
	// verifies it against the server (AuthorizeUninstall) before removing
	// anything. Gating the *script download* only ever stopped the convenient
	// path, never a determined one, and it blocked legitimate admin-assisted
	// removals too.
	_ = emp

	osType := strings.ToLower(c.Param("os"))

	switch osType {
	case "macos":
		c.Header("Content-Disposition", `attachment; filename="aavishield-uninstall.command"`)
		c.Header("Content-Type", "application/octet-stream")
		c.String(http.StatusOK, buildMacOSUninstaller())
	case "windows":
		c.Header("Content-Disposition", `attachment; filename="aavishield-uninstall.bat"`)
		c.Header("Content-Type", "application/octet-stream")
		c.String(http.StatusOK, buildWindowsUninstaller())
	case "linux":
		c.Header("Content-Disposition", `attachment; filename="aavishield-uninstall.sh"`)
		c.Header("Content-Type", "application/octet-stream")
		c.String(http.StatusOK, buildLinuxUninstaller())
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported OS"})
	}
}

// ─── Activity ─────────────────────────────────────────────────────────────────

// Activity handles GET /api/v1/portal/activity
func (h *PortalHandler) Activity(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	action := c.Query("action")
	search := c.Query("search")
	days, _ := strconv.Atoi(c.Query("days"))
	if page < 1 {
		page = 1
	}
	if limit > 100 {
		limit = 100
	}

	q := h.db.Where("employee_id = ?", emp.ID)
	if action != "" {
		q = q.Where("action = ?", action)
	}
	if days > 0 {
		q = q.Where("timestamp >= ?", time.Now().AddDate(0, 0, -days))
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("target_domain LIKE ? OR target LIKE ? OR category LIKE ? OR policy_name LIKE ?", like, like, like, like)
	}

	var total int64
	q.Model(&models.ActivityEvent{}).Count(&total)

	var events []models.ActivityEvent
	q.Order("timestamp DESC").
		Offset((page - 1) * limit).Limit(limit).
		Find(&events)

	c.JSON(http.StatusOK, gin.H{
		"data":  events,
		"total": total,
		"page":  page,
		"limit": limit,
		"pages": (total + int64(limit) - 1) / int64(limit),
	})
}

// ActivityStats handles GET /api/v1/portal/activity/stats
func (h *PortalHandler) ActivityStats(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}

	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	since := time.Now().AddDate(0, 0, -days)

	var blockedCount, allowedCount int64
	h.db.Model(&models.ActivityEvent{}).
		Where("employee_id = ? AND timestamp >= ? AND action = 'blocked'", emp.ID, since).Count(&blockedCount)
	h.db.Model(&models.ActivityEvent{}).
		Where("employee_id = ? AND timestamp >= ? AND action = 'allowed'", emp.ID, since).Count(&allowedCount)

	type DomainCount struct {
		Domain string `json:"domain"`
		Count  int    `json:"count"`
		Reason string `json:"reason"`
	}
	var topBlocked []DomainCount
	h.db.Raw(`
		SELECT target_domain as domain, COUNT(*) as count, MAX(policy_name) as reason
		FROM activity_events
		WHERE employee_id = ? AND timestamp >= ? AND action = 'blocked' AND target_domain != ''
		GROUP BY target_domain ORDER BY count DESC LIMIT 10`, emp.ID, since).Scan(&topBlocked)

	type DayCount struct {
		Date    string `json:"date"`
		Blocked int    `json:"blocked"`
		Allowed int    `json:"allowed"`
	}
	var byDay []DayCount
	h.db.Raw(`
		SELECT TO_CHAR(DATE(timestamp), 'YYYY-MM-DD') as date,
		COUNT(*) FILTER (WHERE action = 'blocked') as blocked,
		COUNT(*) FILTER (WHERE action = 'allowed') as allowed
		FROM activity_events
		WHERE employee_id = ? AND timestamp >= ?
		GROUP BY DATE(timestamp) ORDER BY date ASC`, emp.ID, since).Scan(&byDay)

	c.JSON(http.StatusOK, gin.H{
		"blocked":     blockedCount,
		"allowed":     allowedCount,
		"top_blocked": topBlocked,
		"by_day":      byDay,
		"period_days": days,
	})
}

// Devices handles GET /api/v1/portal/devices
func (h *PortalHandler) Devices(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}

	var devices []models.Device
	h.db.Where("employee_id = ?", emp.ID).Order("last_seen_at DESC").Find(&devices)
	c.JSON(http.StatusOK, gin.H{"data": devices})
}

// DeleteDevice handles DELETE /api/v1/portal/devices/:id
// Lets an employee remove one of their own enrolled devices from the list.
// This also invalidates the device's agent key, so a still-running agent on
// that machine will stop reporting on its next call.
func (h *PortalHandler) DeleteDevice(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}
	devID := c.Param("id")

	var device models.Device
	if err := h.db.Where("id = ? AND employee_id = ?", devID, emp.ID).First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	h.db.Where("device_id = ?", device.ID).Delete(&models.AgentToken{})
	h.db.Delete(&device)
	h.db.Model(&models.Employee{}).Where("id = ? AND device_count > 0", emp.ID).
		UpdateColumn("device_count", gorm.Expr("device_count - 1"))

	c.JSON(http.StatusOK, gin.H{"message": "Device removed"})
}

// ─── Admin: portal password provisioning for employees ────────────────────────

// provisionPortalPassword generates a random password, hashes and stores it
// on the employee, and emails it to them — the one path both a fresh
// employee creation (EmployeeHandler.Create) and an admin-triggered reset
// (SetPortalPassword below) go through, so there's exactly one way an
// employee's portal password is ever set: the admin never sees or chooses
// it themselves, it's generated server-side and delivered by email.
func provisionPortalPassword(db *gorm.DB, emp *models.Employee, orgName string) error {
	password := generatePassword()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if err := db.Model(emp).Update("portal_password_hash", string(hash)).Error; err != nil {
		return err
	}
	mailer.PortalAccessReady(emp.Email, emp.FirstName, orgName, password)
	return nil
}

// orgNameFor is a best-effort lookup used only for the email's greeting —
// a missing org name shouldn't stop the password from being set and sent.
func orgNameFor(db *gorm.DB, orgID uuid.UUID) string {
	var org models.Organization
	if err := db.First(&org, "id = ?", orgID).Error; err == nil {
		return org.Name
	}
	return "your organization"
}

// SetPortalPassword handles POST /employees/:id/portal-password — resets an
// employee's portal password and emails them the new one. No password
// travels in the request: this always generates a fresh one, the same as
// what happens automatically when the employee is first created.
func (h *PortalHandler) SetPortalPassword(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	empID := c.Param("id")

	var emp models.Employee
	if err := h.db.Where("id = ? AND org_id = ?", empID, orgID).First(&emp).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Employee not found"})
		return
	}

	if err := provisionPortalPassword(h.db, &emp, orgNameFor(h.db, emp.OrgID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset the portal password"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "A new password was emailed to the employee.",
		"employee": emp.FullName(),
		"email":    emp.Email,
	})
}

// ─── Portal middleware helper ─────────────────────────────────────────────────

// portalEmployee extracts the authenticated employee from the portal JWT context.
func (h *PortalHandler) portalEmployee(c *gin.Context) (*models.Employee, bool) {
	empIDStr, exists := c.Get("portal_employee_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Employee portal authentication required"})
		return nil, false
	}
	orgIDStr, _ := c.Get("portal_org_id")

	var emp models.Employee
	if err := h.db.Where("id = ? AND org_id = ?", empIDStr, orgIDStr).
		Preload("Team").First(&emp).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Employee not found"})
		return nil, false
	}
	return &emp, true
}

// ─── Installer builders ───────────────────────────────────────────────────────

// ─── Bootstrap installers (no Python required) ────────────────────────────────
//
// Served instead of the Python installers whenever a native package exists for
// the OS. They do three things and stop: save the enrollment token, download
// the signed package, install it. The agent inside that package bundles its own
// runtime and self-enrolls from the drop on first start, so nothing here parses
// JSON or needs an interpreter.
//
// The token goes to ~/.aavishield/enroll.json — owned by the employee, because
// the agent runs in their session rather than as root. The agent deletes it
// once enrollment succeeds.

func buildMacOSBootstrap(token, employeeName, adminURL, pkgName string) string {
	return fmt.Sprintf(`#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Aavishield Agent Installer — macOS
#  Generated for: %s
#  Generated at: %s
#
#  HOW TO USE:
#    bash ~/Downloads/aavishield-install.command
#  Enter your Mac password when prompted — installing system
#  software requires it. Nothing else needs to be installed first.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

ADMIN_URL="%s"
TOKEN="%s"
PKG="%s"

die() { printf "\033[31mERROR: %%s\033[0m\n" "$*"; echo; echo "Press any key to close..."; read -r -n 1 -s; exit 1; }

echo "Installing Aavishield security agent..."
echo

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "  [1/3] Downloading installer..."
curl -fsSL "$ADMIN_URL/agent/packages/$PKG" -o "$TMP/$PKG" \
    || die "Could not download the installer. Check your internet connection."

echo "  [2/3] Saving your enrolment code..."
mkdir -p "$HOME/.aavishield"
printf '{"token":"%%s","admin_url":"%%s"}\n' "$TOKEN" "$ADMIN_URL" > "$HOME/.aavishield/enroll.json"
chmod 600 "$HOME/.aavishield/enroll.json"

echo "  [3/3] Installing (your Mac password is required)..."
sudo installer -pkg "$TMP/$PKG" -target / \
    || die "Installation failed. Contact your IT administrator."

echo
printf "\033[32mDone — Aavishield is now protecting this Mac.\033[0m\n"
echo "You can close this window."
`, employeeName, time.Now().Format(time.RFC1123), adminURL, token, pkgName)
}

func buildWindowsBootstrap(token, employeeName, adminURL, msiName string) string {
	return fmt.Sprintf(`@echo off
REM ═══════════════════════════════════════════════════════════════
REM  Aavishield Agent Installer — Windows
REM  Generated for: %s
REM  Generated at: %s
REM
REM  HOW TO USE: right-click this file, choose "Run as administrator".
REM  Nothing else needs to be installed first.
REM ═══════════════════════════════════════════════════════════════
setlocal

set "ADMIN_URL=%s"
set "TOKEN=%s"
set "MSI=%s"

net session >nul 2>&1
if %%errorLevel%% neq 0 (
    echo [ERROR] Please right-click this file and choose "Run as administrator".
    pause
    exit /b 1
)

echo Installing Aavishield security agent...
echo.

echo   [1/3] Downloading installer...
REM curl.exe ships with Windows 10 1803+ and Windows 11.
curl -fsSL "%%ADMIN_URL%%/agent/packages/%%MSI%%" -o "%%TEMP%%\%%MSI%%"
if %%errorLevel%% neq 0 (
    echo [ERROR] Could not download the installer. Check your internet connection.
    pause
    exit /b 1
)

echo   [2/3] Saving your enrolment code...
if not exist "%%USERPROFILE%%\.aavishield" mkdir "%%USERPROFILE%%\.aavishield"
> "%%USERPROFILE%%\.aavishield\enroll.json" echo {"token":"%%TOKEN%%","admin_url":"%%ADMIN_URL%%"}

echo   [3/3] Installing...
msiexec /i "%%TEMP%%\%%MSI%%" /qn /norestart
if %%errorLevel%% neq 0 (
    echo [ERROR] Installation failed ^(code %%errorLevel%%^). Contact your IT administrator.
    pause
    exit /b 1
)

del /q "%%TEMP%%\%%MSI%%" 2>nul

echo.
echo Done — Aavishield is now protecting this PC.
pause
`, employeeName, time.Now().Format(time.RFC1123), adminURL, token, msiName)
}

func buildLinuxBootstrap(token, employeeName, adminURL, debName string) string {
	return fmt.Sprintf(`#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Aavishield Agent Installer — Linux
#  Generated for: %s
#  Generated at: %s
#
#  HOW TO USE:  bash aavishield-install.sh
#  Nothing else needs to be installed first.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

ADMIN_URL="%s"
TOKEN="%s"
DEB="%s"

die() { printf "\033[31mERROR: %%s\033[0m\n" "$*"; exit 1; }

echo "Installing Aavishield security agent..."
echo

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "  [1/3] Downloading installer..."
curl -fsSL "$ADMIN_URL/agent/packages/$DEB" -o "$TMP/$DEB" \
    || die "Could not download the installer. Check your internet connection."

echo "  [2/3] Saving your enrolment code..."
mkdir -p "$HOME/.aavishield"
printf '{"token":"%%s","admin_url":"%%s"}\n' "$TOKEN" "$ADMIN_URL" > "$HOME/.aavishield/enroll.json"
chmod 600 "$HOME/.aavishield/enroll.json"

echo "  [3/3] Installing (your password is required)..."
sudo dpkg -i "$TMP/$DEB" || die "Installation failed. Contact your IT administrator."

systemctl --user daemon-reload 2>/dev/null || true
systemctl --user enable --now aavishield-agent.service 2>/dev/null || true

echo
printf "\033[32mDone — Aavishield is now protecting this device.\033[0m\n"
`, employeeName, time.Now().Format(time.RFC1123), adminURL, token, debName)
}

func buildMacOSInstaller(token, employeeName, adminURL, swgHost string, swgPort int) string {
	return fmt.Sprintf(`#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Aavishield Agent Installer — macOS
#  Generated for: %s
#  Generated at: %s
#
#  HOW TO USE:
#  1. This file was downloaded from your company's security portal.
#  2. Open Terminal (Spotlight → type Terminal → press Enter).
#  3. Run the following two commands:
#       chmod +x ~/Downloads/aavishield-install.command
#       xattr -d com.apple.quarantine ~/Downloads/aavishield-install.command
#  4. Then run:  bash ~/Downloads/aavishield-install.command
#  5. When done, all your browser traffic will be protected.
#
#  NOTE: macOS blocks unsigned scripts downloaded from the internet.
#  Steps 3-4 remove that restriction so the installer can run.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

ENROLLMENT_TOKEN="%s"
export AAVISHIELD_ADMIN_URL="%s"
export AAVISHIELD_SWG_HOST="%s"
export AAVISHIELD_SWG_PORT="%d"

INSTALL_DIR="$HOME/.aavishield"
CONFIG_FILE="$INSTALL_DIR/config.json"
AGENT_SCRIPT="$INSTALL_DIR/aavishield-agent.py"
LOG_FILE="$INSTALL_DIR/agent.log"
PLIST_FILE="$HOME/Library/LaunchAgents/com.aavishield.agent.plist"
AGENT_LABEL="com.aavishield.agent"
LOCAL_PORT=6118

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${BLUE}→${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
die()  { echo -e "${RED}✗${NC} $*"; read -p "Press Enter to close..."; exit 1; }

clear
echo -e "${BOLD}${BLUE}"
echo "  ██████╗ ███████╗██╗     ███████╗███████╗ ██████╗██╗   ██╗██████╗ ███████╗"
echo "  ██╔══██╗██╔════╝██║     ██╔════╝██╔════╝██╔════╝██║   ██║██╔══██╗██╔════╝"
echo "  ██║  ██║█████╗  ██║     ███████╗█████╗  ██║     ██║   ██║██████╔╝█████╗  "
echo "  ██║  ██║██╔══╝  ██║     ╚════██║██╔══╝  ██║     ██║   ██║██╔══██╗██╔══╝  "
echo "  ██████╔╝███████╗███████╗███████║███████╗╚██████╗╚██████╔╝██║  ██║███████╗"
echo "  ╚═════╝ ╚══════╝╚══════╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝"
echo -e "${NC}"
echo -e "  Security Agent Installer"
echo -e "  Installing for: ${BOLD}%s${NC}"
echo ""

command -v python3 &>/dev/null || die "Python 3 is required. Install from https://www.python.org"
command -v curl &>/dev/null || die "curl is required"

mkdir -p "$INSTALL_DIR"
touch "$LOG_FILE"
chmod 700 "$INSTALL_DIR"

HOSTNAME=$(hostname -s 2>/dev/null || hostname)
OS_VERSION=$(sw_vers -productVersion 2>/dev/null || echo "unknown")
MAC_ADDR=$(ifconfig en0 2>/dev/null | awk '/ether/{print $2}' | head -1 || echo "")

info "Registering this device with your company security system..."

ENROLL_PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'token': '$ENROLLMENT_TOKEN',
    'hostname': '$HOSTNAME',
    'os_type': 'darwin',
    'os_version': '$OS_VERSION',
    'mac_address': '$MAC_ADDR',
    'agent_version': '1.0.0',
}))
")

HTTP_RESPONSE=$(curl -s -w "\n%%{http_code}" \
    -X POST "$AAVISHIELD_ADMIN_URL/internal/agent/enroll" \
    -H "Content-Type: application/json" \
    -d "$ENROLL_PAYLOAD") || die "Cannot reach security server. Check your network connection."

HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)

if [[ "$HTTP_CODE" != "200" ]]; then
    die "Registration failed (Error $HTTP_CODE). This installer may have expired — download a new one from the employee portal."
fi

DEVICE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['device_id'])" 2>/dev/null) || die "Registration error"
AGENT_KEY=$(echo "$HTTP_BODY"  | python3 -c "import sys,json; print(json.load(sys.stdin)['agent_key'])"  2>/dev/null) || die "Registration error"
ORG_ID=$(echo "$HTTP_BODY"    | python3 -c "import sys,json; print(json.load(sys.stdin)['org_id'])"    2>/dev/null) || die "Registration error"
EMPLOYEE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('employee_id') or '')" 2>/dev/null || echo "")

ok "Device registered successfully!"

python3 -c "
import json
cfg = {
    'device_id': '$DEVICE_ID',
    'agent_key': '$AGENT_KEY',
    'org_id': '$ORG_ID',
    'employee_id': '$EMPLOYEE_ID',
    'swg_host': '$AAVISHIELD_SWG_HOST',
    'swg_port': $AAVISHIELD_SWG_PORT,
    'admin_url': '$AAVISHIELD_ADMIN_URL',
    'local_port': $LOCAL_PORT,
    'hostname': '$HOSTNAME',
    'os_type': 'darwin',
    'os_version': '$OS_VERSION',
    'agent_version': '1.0.0',
    'mitm_ca_installed': False,
}
with open('$CONFIG_FILE', 'w') as f:
    json.dump(cfg, f, indent=2)
"
chmod 600 "$CONFIG_FILE"

info "Installing security agent..."
curl -fsSL "$AAVISHIELD_ADMIN_URL/agent/aavishield-agent.py" -o "$AGENT_SCRIPT" || die "Failed to download agent script from $AAVISHIELD_ADMIN_URL"
chmod +x "$AGENT_SCRIPT"

MITM_CA_INSTALLED=false
info "Installing SSL Inspection certificate (needed for DLP over HTTPS)..."
if curl -fsSL "$AAVISHIELD_ADMIN_URL/internal/agent/ca-cert" \
    -H "Authorization: Bearer $DEVICE_ID:$AGENT_KEY" -o "$INSTALL_DIR/ca.pem" 2>/dev/null \
    && [[ -s "$INSTALL_DIR/ca.pem" ]]; then
    if sudo -v 2>/dev/null && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$INSTALL_DIR/ca.pem" 2>/dev/null; then
        MITM_CA_INSTALLED=true
        ok "SSL Inspection certificate installed"
    else
        echo -e "${YELLOW}!${NC} Could not install SSL Inspection certificate — HTTPS will be blind-tunneled until this is fixed."
    fi
else
    echo -e "${YELLOW}!${NC} Could not download SSL Inspection certificate — HTTPS will be blind-tunneled until this is fixed."
fi

python3 -c "
import json
p = '$CONFIG_FILE'
with open(p) as f:
    cfg = json.load(f)
cfg['mitm_ca_installed'] = '$MITM_CA_INSTALLED' == 'true'
with open(p, 'w') as f:
    json.dump(cfg, f, indent=2)
"

if [[ -x /usr/bin/python3 ]]; then
    PYTHON_BIN=/usr/bin/python3
else
    PYTHON_BIN=$(command -v python3)
fi
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_FILE" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON_BIN}</string>
        <string>${AGENT_SCRIPT}</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>StandardOutPath</key><string>${LOG_FILE}</string>
    <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST_FILE" 2>/dev/null || true
launchctl load   "$PLIST_FILE"

info "Waiting for agent to start..."
# Startup does a few sequential 10s-timeout calls to the admin API (rules,
# MITM config, enforcement state) before the proxy socket opens, so on a slow
# network this can legitimately take close to 30s — not just an instant bind.
AGENT_READY=false
for _ in $(seq 1 40); do
    if python3 -c "import socket; s=socket.create_connection(('127.0.0.1',$LOCAL_PORT),timeout=1); s.close()" 2>/dev/null; then
        AGENT_READY=true
        break
    fi
    sleep 1
done
[[ "$AGENT_READY" == "true" ]] || die "Agent failed to start after 40s. Check: tail -20 $LOG_FILE"

info "Configuring network proxy..."
while IFS= read -r SERVICE; do
    [[ -z "$SERVICE" || "$SERVICE" == "An asterisk"* ]] && continue
    networksetup -setwebproxy "$SERVICE" "127.0.0.1" "$LOCAL_PORT" 2>/dev/null && networksetup -setwebproxystate "$SERVICE" on 2>/dev/null || true
    networksetup -setsecurewebproxy "$SERVICE" "127.0.0.1" "$LOCAL_PORT" 2>/dev/null && networksetup -setsecurewebproxystate "$SERVICE" on 2>/dev/null || true
    networksetup -setproxybypassdomains "$SERVICE" "localhost" "127.0.0.1" "*.local" "169.254/16" "fe80::/10" 2>/dev/null || true
done < <(networksetup -listallnetworkservices 2>/dev/null | tail -n +2)

# A browser extension with the "proxy" permission (VeePN, Hola, etc.) can
# override a browser's proxy for itself, bypassing the OS-level proxy above
# just for that browser. This affects every Chromium-based browser (Chrome,
# Edge, Brave — same extension API); Firefox uses a different mechanism and
# is handled separately below. Safari has no such extension proxy API.
info "Locking installed browsers' proxy configs against browser-extension VPNs (admin password needed)..."
if sudo -v 2>/dev/null; then
    CHROMIUM_JSON=$(cat << CHROMIUM_POLICY_EOF
{
  "ProxySettings": {
    "ProxyMode": "fixed_servers",
    "ProxyServer": "127.0.0.1:$LOCAL_PORT",
    "ProxyBypassList": "<local>"
  }
}
CHROMIUM_POLICY_EOF
)
    sudo mkdir -p "/Library/Application Support/Google/Chrome/policies/managed"
    echo "$CHROMIUM_JSON" | sudo tee "/Library/Application Support/Google/Chrome/policies/managed/aavishield-proxy-lock.json" > /dev/null
    ok "Chrome proxy locked"

    if [[ -d "/Applications/Microsoft Edge.app" ]]; then
        sudo mkdir -p "/Library/Application Support/Microsoft Edge/policies/managed"
        echo "$CHROMIUM_JSON" | sudo tee "/Library/Application Support/Microsoft Edge/policies/managed/aavishield-proxy-lock.json" > /dev/null
        ok "Edge proxy locked"
    fi

    if [[ -d "/Applications/Brave Browser.app" ]]; then
        sudo mkdir -p "/Library/Application Support/BraveSoftware/Brave-Browser/policies/managed"
        echo "$CHROMIUM_JSON" | sudo tee "/Library/Application Support/BraveSoftware/Brave-Browser/policies/managed/aavishield-proxy-lock.json" > /dev/null
        ok "Brave proxy locked"
    fi

    if [[ -d "/Applications/Firefox.app" ]]; then
        sudo mkdir -p "/Applications/Firefox.app/Contents/Resources/distribution"
        sudo tee "/Applications/Firefox.app/Contents/Resources/distribution/policies.json" > /dev/null << FIREFOX_POLICY_EOF
{
  "policies": {
    "Proxy": {
      "Mode": "manual",
      "Locked": true,
      "HTTPProxy": "127.0.0.1:$LOCAL_PORT",
      "SSLProxy": "127.0.0.1:$LOCAL_PORT",
      "UseHTTPProxyForAllProtocols": true,
      "Passthrough": "<local>, 127.0.0.1, localhost"
    },
    "Certificates": { "ImportEnterpriseRoots": true }
  }
}
FIREFOX_POLICY_EOF
        ok "Firefox proxy locked"
    fi

    ok "Browser proxy locks applied — restart any open browsers for this to take effect"
else
    echo -e "${YELLOW}!${NC} Skipped browser hardening (no admin password given) — a VPN/proxy browser extension could still bypass filtering."
fi

echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  ✅  Aavishield Security Agent installed successfully!${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Your device is now protected by your company's security policy."
echo "  Blocked websites will display a Aavishield block page."
echo "  You can see your security activity at the employee portal."
echo ""
echo "  You can close this Terminal window now."
echo ""
read -p "  Press Enter to close..."
`, employeeName, time.Now().UTC().Format(time.RFC3339), token, adminURL, swgHost, swgPort, employeeName)
}

func buildWindowsInstaller(token, employeeName, adminURL, swgHost string, swgPort int) string {
	return fmt.Sprintf(`@echo off
:: ═══════════════════════════════════════════════════════════════
::  Aavishield Agent Installer — Windows
::  Generated for: %s
::  Generated at: %s
::
::  HOW TO USE:
::  1. Right-click this file and select "Run as administrator"
::  2. The installer will run automatically
::  3. When done, your browser traffic will be protected
:: ═══════════════════════════════════════════════════════════════

title Aavishield Security Agent Installer

echo.
echo   =====================================
echo    AAVISHIELD - Security Agent Installer
echo    Installing for: %s
echo   =====================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed.
    echo Please download Python from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

:: Set variables
set ENROLLMENT_TOKEN=%s
set AAVISHIELD_ADMIN_URL=%s
set AAVISHIELD_SWG_HOST=%s
set AAVISHIELD_SWG_PORT=%d
set INSTALL_DIR=%%USERPROFILE%%\.aavishield
set CONFIG_FILE=%%INSTALL_DIR%%\config.json
set AGENT_SCRIPT=%%INSTALL_DIR%%\aavishield-agent.py
set LOCAL_PORT=6118

mkdir "%%INSTALL_DIR%%" 2>nul

echo [*] Registering this device with your company security system...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"$ErrorActionPreference='Stop'; ^
$body = @{token='%%ENROLLMENT_TOKEN%%';hostname=$env:COMPUTERNAME;os_type='windows';os_version=(Get-WmiObject Win32_OperatingSystem).Caption;agent_version='1.0.0'} | ConvertTo-Json -Compress; ^
$r = Invoke-RestMethod -Uri '%%AAVISHIELD_ADMIN_URL%%/internal/agent/enroll' -Method POST -Body $body -ContentType 'application/json'; ^
$r | ConvertTo-Json | Set-Content '%%INSTALL_DIR%%\enroll_response.json'"

if errorlevel 1 (
    echo [ERROR] Registration failed. Check your network connection.
    pause
    exit /b 1
)

echo [OK] Device registered!

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"$r = Get-Content '%%INSTALL_DIR%%\enroll_response.json' | ConvertFrom-Json; ^
$cfg = @{device_id=$r.device_id;agent_key=$r.agent_key;org_id=$r.org_id;employee_id=$r.employee_id;swg_host='%%AAVISHIELD_SWG_HOST%%';swg_port=%%AAVISHIELD_SWG_PORT%%;admin_url='%%AAVISHIELD_ADMIN_URL%%';local_port=%%LOCAL_PORT%%;hostname=$env:COMPUTERNAME;os_type='windows';agent_version='1.0.0';mitm_ca_installed=$false}; ^
$cfg | ConvertTo-Json | Set-Content '%%CONFIG_FILE%%'"

echo [*] Installing agent service...

:: Download the agent script
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"try { Invoke-WebRequest -Uri '%%AAVISHIELD_ADMIN_URL%%/agent/aavishield-agent.py' -OutFile '%%AGENT_SCRIPT%%' -UseBasicParsing } catch { Write-Host '[ERROR] Failed to download agent script'; exit 1 }"
if errorlevel 1 (
    echo [ERROR] Failed to download agent script from %%AAVISHIELD_ADMIN_URL%%
    pause
    exit /b 1
)

:: SSL Inspection (DLP over HTTPS): install this org's CA before the proxy is
:: enabled. If the CA cannot be trusted, the agent will blind-tunnel HTTPS.
echo [*] Installing SSL Inspection certificate (needed for DLP over HTTPS)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"$c = Get-Content '%%CONFIG_FILE%%' | ConvertFrom-Json; ^
$ok = $false; ^
try { ^
    Invoke-WebRequest -Uri \"$($c.admin_url)/internal/agent/ca-cert\" -Headers @{Authorization=\"Bearer $($c.device_id):$($c.agent_key)\"} -OutFile '%%INSTALL_DIR%%\ca.pem' -UseBasicParsing; ^
    Import-Certificate -FilePath '%%INSTALL_DIR%%\ca.pem' -CertStoreLocation Cert:\LocalMachine\Root | Out-Null; ^
    New-Item -Path 'HKLM:\SOFTWARE\Policies\Mozilla\Firefox\Certificates' -Force | Out-Null; ^
    New-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Mozilla\Firefox\Certificates' -Name ImportEnterpriseRoots -Value 1 -PropertyType DWord -Force | Out-Null; ^
    $ok = $true; ^
    Write-Host '[OK] SSL Inspection certificate installed' ^
} catch { Write-Host '[WARN] Could not install SSL Inspection certificate; HTTPS will be blind-tunneled until this is fixed.' }; ^
$c.mitm_ca_installed = $ok; ^
$c | ConvertTo-Json | Set-Content '%%CONFIG_FILE%%'"

:: Register as scheduled task
schtasks /delete /tn "AavishieldAgent" /f 2>nul
schtasks /create /tn "AavishieldAgent" /tr "python \"%%AGENT_SCRIPT%%\"" /sc onlogon /ru %%USERNAME%% /f /rl LIMITED
schtasks /run /tn "AavishieldAgent"

:: Set system proxy
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /t REG_SZ /d "127.0.0.1:%%LOCAL_PORT%%" /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyOverride /t REG_SZ /d "localhost;127.0.0.1;<local>" /f

echo.
echo   ==========================================
echo    SUCCESS! Aavishield Agent is now running.
echo    Your browsing is now protected.
echo   ==========================================
echo.
pause
`, employeeName, time.Now().UTC().Format(time.RFC3339), employeeName,
		token, adminURL, swgHost, swgPort)
}

func buildLinuxInstaller(token, employeeName, adminURL, swgHost string, swgPort int) string {
	return fmt.Sprintf(`#!/usr/bin/env bash
# Aavishield Agent Installer — Linux
# Generated for: %s
set -euo pipefail

ENROLLMENT_TOKEN="%s"
export AAVISHIELD_ADMIN_URL="%s"
export AAVISHIELD_SWG_HOST="%s"
export AAVISHIELD_SWG_PORT="%d"
LOCAL_PORT=6118
INSTALL_DIR="$HOME/.aavishield"
CONFIG_FILE="$INSTALL_DIR/config.json"
AGENT_SCRIPT="$INSTALL_DIR/aavishield-agent.py"
SERVICE_FILE="$HOME/.config/systemd/user/aavishield-agent.service"

command -v python3 &>/dev/null || { echo "Python 3 required"; exit 1; }
command -v curl &>/dev/null || { echo "curl required"; exit 1; }

mkdir -p "$INSTALL_DIR"

HOSTNAME=$(hostname -s)
OS_VERSION=$(uname -r)

echo "→ Registering device..."
HTTP_RESPONSE=$(curl -s -w "\n%%{http_code}" \
    -X POST "$AAVISHIELD_ADMIN_URL/internal/agent/enroll" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$ENROLLMENT_TOKEN\",\"hostname\":\"$HOSTNAME\",\"os_type\":\"linux\",\"os_version\":\"$OS_VERSION\",\"agent_version\":\"1.0.0\"}")

HTTP_BODY=$(echo "$HTTP_RESPONSE" | head -n -1)
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)
[[ "$HTTP_CODE" != "200" ]] && { echo "Registration failed: $HTTP_BODY"; exit 1; }

DEVICE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['device_id'])")
AGENT_KEY=$(echo "$HTTP_BODY"  | python3 -c "import sys,json; print(json.load(sys.stdin)['agent_key'])")
ORG_ID=$(echo "$HTTP_BODY"    | python3 -c "import sys,json; print(json.load(sys.stdin)['org_id'])")
EMPLOYEE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('employee_id') or '')" 2>/dev/null || echo "")

echo "✓ Registered: $DEVICE_ID"

python3 -c "
import json
cfg={'device_id':'$DEVICE_ID','agent_key':'$AGENT_KEY','org_id':'$ORG_ID','employee_id':'$EMPLOYEE_ID',
     'swg_host':'$AAVISHIELD_SWG_HOST','swg_port':$AAVISHIELD_SWG_PORT,'admin_url':'$AAVISHIELD_ADMIN_URL',
     'local_port':$LOCAL_PORT,'hostname':'$HOSTNAME','os_type':'linux','agent_version':'1.0.0',
     'mitm_ca_installed':False}
with open('$CONFIG_FILE','w') as f: json.dump(cfg,f,indent=2)
"
chmod 600 "$CONFIG_FILE"

curl -fsSL "$AAVISHIELD_ADMIN_URL/agent/aavishield-agent.py" -o "$AGENT_SCRIPT" || cp "$(dirname "$0")/aavishield-agent.py" "$AGENT_SCRIPT"
chmod +x "$AGENT_SCRIPT"

MITM_CA_INSTALLED=false
echo "→ Installing SSL Inspection certificate (needed for DLP over HTTPS)..."
if curl -fsSL "$AAVISHIELD_ADMIN_URL/internal/agent/ca-cert" \
    -H "Authorization: Bearer $DEVICE_ID:$AGENT_KEY" -o "$INSTALL_DIR/ca.pem" 2>/dev/null \
    && [[ -s "$INSTALL_DIR/ca.pem" ]]; then
    if command -v update-ca-certificates &>/dev/null && sudo -v 2>/dev/null; then
        sudo cp "$INSTALL_DIR/ca.pem" /usr/local/share/ca-certificates/aavishield-ca.crt \
            && sudo update-ca-certificates &>/dev/null \
            && MITM_CA_INSTALLED=true \
            && echo "✓ SSL Inspection certificate installed"
    elif command -v update-ca-trust &>/dev/null && sudo -v 2>/dev/null; then
        sudo cp "$INSTALL_DIR/ca.pem" /etc/pki/ca-trust/source/anchors/aavishield-ca.crt \
            && sudo update-ca-trust &>/dev/null \
            && MITM_CA_INSTALLED=true \
            && echo "✓ SSL Inspection certificate installed"
    else
        echo "! Could not install SSL Inspection certificate automatically — HTTPS will be blind-tunneled until this is fixed."
    fi
    for FF_POLICY_DIR in /etc/firefox/policies /usr/lib/firefox/distribution /usr/lib64/firefox/distribution; do
        if [[ -d "$(dirname "$FF_POLICY_DIR")" ]] && sudo -v 2>/dev/null; then
            sudo mkdir -p "$FF_POLICY_DIR" 2>/dev/null
            echo '{"policies":{"Certificates":{"ImportEnterpriseRoots":true}}}' | sudo tee "$FF_POLICY_DIR/policies.json" >/dev/null 2>&1 || true
        fi
    done
else
    echo "! Could not download SSL Inspection certificate — HTTPS will be blind-tunneled until this is fixed."
fi

python3 -c "
import json
p = '$CONFIG_FILE'
with open(p) as f:
    cfg = json.load(f)
cfg['mitm_ca_installed'] = '$MITM_CA_INSTALLED' == 'true'
with open(p, 'w') as f:
    json.dump(cfg, f, indent=2)
"

mkdir -p "$(dirname "$SERVICE_FILE")"
cat > "$SERVICE_FILE" << UNIT
[Unit]
Description=Aavishield Security Agent
After=network.target

[Service]
ExecStart=$(command -v python3) $AGENT_SCRIPT
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable aavishield-agent
systemctl --user start aavishield-agent

gsettings set org.gnome.system.proxy mode 'manual' 2>/dev/null || true
gsettings set org.gnome.system.proxy.http host '127.0.0.1' 2>/dev/null || true
gsettings set org.gnome.system.proxy.http port $LOCAL_PORT 2>/dev/null || true
gsettings set org.gnome.system.proxy.https host '127.0.0.1' 2>/dev/null || true
gsettings set org.gnome.system.proxy.https port $LOCAL_PORT 2>/dev/null || true

export http_proxy="http://127.0.0.1:$LOCAL_PORT"
export https_proxy="http://127.0.0.1:$LOCAL_PORT"
echo "export http_proxy=http://127.0.0.1:$LOCAL_PORT" >> ~/.bashrc
echo "export https_proxy=http://127.0.0.1:$LOCAL_PORT" >> ~/.bashrc

echo ""
echo "✅ Aavishield Agent installed! Device: $DEVICE_ID"
echo "   Your browsing is now protected by company policy."
`, employeeName, token, adminURL, swgHost, swgPort)
}

// ─── Uninstaller builders ─────────────────────────────────────────────────────

func buildMacOSUninstaller() string {
	return `#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Aavishield Agent Uninstaller — macOS
#
#  HOW TO USE:
#  1. Open Terminal (Spotlight → Terminal)
#  2. Run: chmod +x ~/Downloads/aavishield-uninstall.command
#  3. Run: xattr -d com.apple.quarantine ~/Downloads/aavishield-uninstall.command
#  4. Run: bash ~/Downloads/aavishield-uninstall.command
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="$HOME/.aavishield"
PLIST_FILE="$HOME/Library/LaunchAgents/com.aavishield.agent.plist"
CONFIG_FILE="$INSTALL_DIR/config.json"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${BLUE}→${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }

clear
echo -e "${BOLD}${BLUE}🛡️  Aavishield Agent Uninstaller — macOS${NC}"
echo "────────────────────────────────────────"
echo

if [[ -f "$CONFIG_FILE" ]]; then
    DEVICE_ID=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('device_id',''))" 2>/dev/null || echo "")
    AGENT_KEY=$(python3  -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('agent_key',''))"  2>/dev/null || echo "")
    ADMIN_URL=$(python3  -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('admin_url',''))"  2>/dev/null || echo "")
    if [[ -n "$DEVICE_ID" && -n "$AGENT_KEY" && -n "$ADMIN_URL" ]]; then
        info "Notifying Aavishield server..."
        curl -s -X POST "$ADMIN_URL/internal/agent/offline" \
            -H "Authorization: Bearer $DEVICE_ID:$AGENT_KEY" \
            -H "Content-Type: application/json" -d '{}' 2>/dev/null || true
        ok "Server notified"
    fi
fi

info "Stopping agent daemon..."
launchctl unload "$PLIST_FILE" 2>/dev/null || true
lsof -ti :6118 2>/dev/null | xargs kill -9 2>/dev/null || true
rm -f "$PLIST_FILE"

# A package install puts its jobs in the system-wide domains instead of the
# user's. The CA-trust daemon has to go before the certificate does — left
# running, it would notice the missing CA and install it straight back.
if sudo -v 2>/dev/null; then
    sudo launchctl bootout system /Library/LaunchDaemons/com.aavishield.catrust.plist 2>/dev/null || true
    sudo launchctl bootout "gui/$(id -u)" /Library/LaunchAgents/com.aavishield.agent.plist 2>/dev/null || true
    sudo rm -f /Library/LaunchDaemons/com.aavishield.catrust.plist \
               /Library/LaunchAgents/com.aavishield.agent.plist
    # /Applications is where the app lives; /usr/local/aavishield is older
    # installs plus the CA-trust marker, so both go.
    sudo rm -rf /etc/aavishield /usr/local/aavishield "/Applications/Aavishield.app"
    sudo pkgutil --forget com.aavishield.agent 2>/dev/null || true
fi
ok "Agent stopped"

info "Removing system proxy settings..."
while IFS= read -r SERVICE; do
    [[ -z "$SERVICE" || "$SERVICE" == "An asterisk"* ]] && continue
    networksetup -setwebproxystate       "$SERVICE" off 2>/dev/null || true
    networksetup -setsecurewebproxystate "$SERVICE" off 2>/dev/null || true
    networksetup -setproxybypassdomains  "$SERVICE" "" 2>/dev/null || true
    ok "Proxy cleared for: $SERVICE"
done < <(networksetup -listallnetworkservices 2>/dev/null | tail -n +2)

info "Removing install files..."
rm -rf "$INSTALL_DIR"
ok "Removed $INSTALL_DIR"

info "Removing SSL Inspection certificate..."
if sudo -v 2>/dev/null; then
    # The CA is trusted in the user's own keychain (see _install_ca_darwin);
    # the System copy only exists on machines an older build touched.
    security delete-certificate -c "Aavishield SSL Inspection CA" 2>/dev/null || true
    sudo security delete-certificate -c "Aavishield SSL Inspection CA" /Library/Keychains/System.keychain 2>/dev/null \
        && ok "SSL Inspection certificate removed" \
        || info "No SSL Inspection certificate found (nothing to remove)"
else
    info "Could not remove SSL Inspection certificate (no admin password given). Remove manually via Keychain Access if present."
fi

BROWSER_POLICY_FILES=(
    "/Library/Application Support/Google/Chrome/policies/managed/aavishield-proxy-lock.json"
    "/Library/Application Support/Microsoft Edge/policies/managed/aavishield-proxy-lock.json"
    "/Library/Application Support/BraveSoftware/Brave-Browser/policies/managed/aavishield-proxy-lock.json"
)
FIREFOX_POLICY_FILE="/Applications/Firefox.app/Contents/Resources/distribution/policies.json"

NEED_CLEANUP=false
for f in "${BROWSER_POLICY_FILES[@]}"; do
    [[ -f "$f" ]] && NEED_CLEANUP=true
done
[[ -f "$FIREFOX_POLICY_FILE" ]] && NEED_CLEANUP=true

if [[ "$NEED_CLEANUP" == "true" ]]; then
    info "Removing browser proxy locks..."
    if sudo -v 2>/dev/null; then
        for f in "${BROWSER_POLICY_FILES[@]}"; do
            [[ -f "$f" ]] && sudo rm -f "$f"
        done
        [[ -f "$FIREFOX_POLICY_FILE" ]] && sudo rm -f "$FIREFOX_POLICY_FILE"
        ok "Browser proxy locks removed — restart any open browsers for this to take effect"
    else
        info "Could not remove browser proxy locks (no admin password given). Remove manually with: sudo rm <file>"
    fi
fi

echo
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  ✅  Aavishield Agent removed successfully!${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "  System proxy has been cleared."
echo "  Your browser traffic is now direct (no proxy)."
echo
read -p "  Press Enter to close..."
`
}

func buildLinuxUninstaller() string {
	return `#!/usr/bin/env bash
# Aavishield Agent Uninstaller — Linux
set -euo pipefail

INSTALL_DIR="$HOME/.aavishield"
CONFIG_FILE="$INSTALL_DIR/config.json"
SERVICE_FILE="$HOME/.config/systemd/user/aavishield-agent.service"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${BLUE}→${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }

echo -e "${BOLD}${BLUE}🛡️  Aavishield Agent Uninstaller — Linux${NC}"
echo

if [[ -f "$CONFIG_FILE" ]]; then
    DEVICE_ID=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('device_id',''))" 2>/dev/null || echo "")
    AGENT_KEY=$(python3  -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('agent_key',''))"  2>/dev/null || echo "")
    ADMIN_URL=$(python3  -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('admin_url',''))"  2>/dev/null || echo "")
    if [[ -n "$DEVICE_ID" && -n "$AGENT_KEY" && -n "$ADMIN_URL" ]]; then
        info "Notifying Aavishield server..."
        curl -s -X POST "$ADMIN_URL/internal/agent/offline" \
            -H "Authorization: Bearer $DEVICE_ID:$AGENT_KEY" \
            -H "Content-Type: application/json" -d '{}' 2>/dev/null || true
        ok "Server notified"
    fi
fi

info "Stopping agent service..."
systemctl --user stop    aavishield-agent 2>/dev/null || true
systemctl --user disable aavishield-agent 2>/dev/null || true
lsof -ti :6118 2>/dev/null | xargs kill -9 2>/dev/null || true
rm -f "$SERVICE_FILE"
systemctl --user daemon-reload 2>/dev/null || true

# A package install puts the CA-trust helper in the system domain. It has to
# stop before the certificate does — left running, it would notice the missing
# CA and install it straight back.
if sudo -v 2>/dev/null; then
    sudo systemctl disable --now aavishield-catrust.service 2>/dev/null || true
    sudo rm -f /usr/local/share/ca-certificates/aavishield-ca.crt
    sudo update-ca-certificates --fresh >/dev/null 2>&1 || true
    sudo rm -rf /etc/aavishield
    sudo systemctl daemon-reload 2>/dev/null || true
fi
ok "Agent stopped"

info "Removing proxy settings..."
gsettings set org.gnome.system.proxy mode 'none' 2>/dev/null || true
for RC in ~/.bashrc ~/.bash_profile ~/.zshrc ~/.profile; do
    [[ -f "$RC" ]] && sed -i '/aavishield\|6118/Id' "$RC" 2>/dev/null || true
done
ok "Proxy settings cleared"

info "Removing install files..."
rm -rf "$INSTALL_DIR"
ok "Removed $INSTALL_DIR"

info "Removing SSL Inspection certificate..."
if sudo -v 2>/dev/null; then
    if [[ -f /usr/local/share/ca-certificates/aavishield-ca.crt ]]; then
        sudo rm -f /usr/local/share/ca-certificates/aavishield-ca.crt
        command -v update-ca-certificates &>/dev/null && sudo update-ca-certificates &>/dev/null
    fi
    if [[ -f /etc/pki/ca-trust/source/anchors/aavishield-ca.crt ]]; then
        sudo rm -f /etc/pki/ca-trust/source/anchors/aavishield-ca.crt
        command -v update-ca-trust &>/dev/null && sudo update-ca-trust &>/dev/null
    fi
    for FF_POLICY in /etc/firefox/policies/policies.json /usr/lib/firefox/distribution/policies.json /usr/lib64/firefox/distribution/policies.json; do
        [[ -f "$FF_POLICY" ]] && sudo rm -f "$FF_POLICY"
    done
    ok "SSL Inspection certificate removed"
else
    info "Could not remove SSL Inspection certificate (no admin password given)."
fi

echo
echo -e "${BOLD}${GREEN}✅  Aavishield Agent removed successfully!${NC}"
echo "  Restart your terminal for changes to take full effect."
`
}

func buildWindowsUninstaller() string {
	return `@echo off
:: ═══════════════════════════════════════════════════════════════
::  Aavishield Agent Uninstaller — Windows
::
::  HOW TO USE:
::  Right-click this file and select "Run as administrator"
:: ═══════════════════════════════════════════════════════════════
title Aavishield Agent Uninstaller

echo.
echo   =====================================
echo    AAVISHIELD - Agent Uninstaller
echo   =====================================
echo.

:: Stop and remove Scheduled Task
echo [*] Stopping agent...
schtasks /end    /tn "AavishieldAgent" >nul 2>&1
schtasks /delete /tn "AavishieldAgent" /f >nul 2>&1

:: The CA-trust helper an .msi install leaves behind runs as SYSTEM and has to
:: stop before the certificate does — left running, it would notice the missing
:: CA and install it straight back.
schtasks /end    /tn "AavishieldCaTrust" >nul 2>&1
schtasks /delete /tn "AavishieldCaTrust" /f >nul 2>&1
del /q "%ProgramData%\Aavishield\ca-trusted" >nul 2>&1
echo [OK] Agent stopped.

:: Notify server and clear proxy via PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"$cfg='%USERPROFILE%\.aavishield\config.json'; ^
if (Test-Path $cfg) { ^
    $c=Get-Content $cfg|ConvertFrom-Json; ^
    try { Invoke-RestMethod -Uri \"$($c.admin_url)/internal/agent/offline\" -Method POST ^
        -Headers @{Authorization=\"Bearer $($c.device_id):$($c.agent_key)\";'Content-Type'='application/json'} ^
        -Body '{}' | Out-Null } catch {} ^
}; ^
$r='HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'; ^
Set-ItemProperty -Path $r -Name ProxyEnable -Value 0; ^
Remove-ItemProperty -Path $r -Name ProxyServer   -ErrorAction SilentlyContinue; ^
Remove-ItemProperty -Path $r -Name ProxyOverride -ErrorAction SilentlyContinue; ^
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W{[DllImport(\"wininet.dll\")]public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l);public static void R(){InternetSetOption(IntPtr.Zero,39,IntPtr.Zero,0);InternetSetOption(IntPtr.Zero,37,IntPtr.Zero,0);}}'; ^
[W]::R(); ^
Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -like '*Aavishield SSL Inspection*' } | Remove-Item -ErrorAction SilentlyContinue; ^
Remove-Item -Path '%USERPROFILE%\.aavishield' -Recurse -Force -ErrorAction SilentlyContinue; ^
Write-Host '[OK] Proxy cleared, SSL Inspection certificate removed, and files removed.'"
reg delete "HKLM\SOFTWARE\Policies\Mozilla\Firefox\Certificates" /v ImportEnterpriseRoots /f >nul 2>&1

echo.
echo   =====================================
echo    SUCCESS! Aavishield Agent removed.
echo    System proxy has been cleared.
echo   =====================================
echo.
pause
`
}

// ─── Config helpers ───────────────────────────────────────────────────────────

func requestHostname(c *gin.Context) string {
	host := c.Request.Host
	if host == "" {
		return "localhost"
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return host
}

func requestScheme(c *gin.Context) string {
	if c.Request.TLS != nil {
		return "https"
	}
	if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
		return proto
	}
	return "http"
}

func adminAPIURL(c *gin.Context) string {
	if u := os.Getenv("ADMIN_API_PUBLIC_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	port := os.Getenv("ADMIN_API_PORT")
	if port == "" {
		port = "6000"
	}
	return fmt.Sprintf("%s://%s:%s", requestScheme(c), requestHostname(c), port)
}

func swgEngineHost(c *gin.Context) string {
	if h := os.Getenv("SWG_PUBLIC_HOST"); h != "" {
		return h
	}
	return requestHostname(c)
}

func swgEnginePort() int {
	if p := os.Getenv("SWG_PUBLIC_PORT"); p != "" {
		n, _ := strconv.Atoi(p)
		if n > 0 {
			return n
		}
	}
	return 6080
}
