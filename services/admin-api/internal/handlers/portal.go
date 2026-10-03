package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/auth"
	"github.com/aavishield/admin-api/internal/authpolicy"
	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
)

type PortalHandler struct {
	db      *gorm.DB
	hub     *WebSocketHub
	lockout *authpolicy.Lockout
}

func NewPortalHandler(db *gorm.DB, hub *WebSocketHub, rdb *redis.Client) *PortalHandler {
	return &PortalHandler{db: db, hub: hub, lockout: authpolicy.NewLockout(rdb)}
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

	ctx := c.Request.Context()
	if locked, retry := h.lockout.Locked(ctx, "portal", req.Email); locked {
		c.Header("Retry-After", retryAfterSeconds(retry))
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many failed sign-ins. Try again in a few minutes."})
		return
	}

	var emp models.Employee
	if err := h.db.Where("email = ? AND status = 'active'", req.Email).
		Preload("Team").First(&emp).Error; err != nil {
		h.lockout.Fail(ctx, "portal", req.Email)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	if emp.PortalPasswordHash == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Portal access not set up. Contact your IT administrator."})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(emp.PortalPasswordHash), []byte(req.Password)); err != nil {
		h.lockout.Fail(ctx, "portal", req.Email)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}
	h.lockout.Reset(ctx, "portal", req.Email)

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

	if reason := authpolicy.ValidatePassword(req.Password, req.Email); reason != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": reason})
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
				// The email always goes out — only the raw-token fallback for
				// a developer without SMTP is restricted to non-production,
				// same as the admin ForgotPassword in auth.go.
				mailer.PasswordReset(emp.Email, emp.FirstName, plain, true)
				if os.Getenv("APP_ENV") != "production" && !mailer.Enabled() {
					resp["reset_token"] = plain
					resp["dev_note"] = "SMTP is not configured — this token is only returned outside production."
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

	var rEmp models.Employee
	if prt.EmployeeID != nil {
		h.db.Select("email").First(&rEmp, "id = ?", *prt.EmployeeID)
	}
	if reason := authpolicy.ValidatePassword(req.NewPassword, rEmp.Email); reason != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": reason})
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
		notifyEmployee(h.db, resetEmp.OrgID, resetEmp.ID, NotifPasswordChanged, "Your password was reset",
			"Your password was reset using an emailed link. If you didn't do this, contact your IT administrator.", "/dashboard/profile")
	}

	c.JSON(http.StatusOK, gin.H{"message": "Password reset successfully"})
}

// ChangePassword handles POST /api/v1/portal/change-password — an employee
// changing their own password from inside the portal (as opposed to
// ForgotPassword/ResetPassword's out-of-session, emailed-token flow).
// Mirrors AuthHandler.ChangePassword's contract (current password required,
// new one bcrypt-hashed) against models.Employee.PortalPasswordHash instead
// of models.User.PasswordHash — the two accounts are entirely separate.
func (h *PortalHandler) ChangePassword(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password" binding:"required"`
		NewPassword     string `json:"new_password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if emp.PortalPasswordHash == "" {
		// Signed up via Google/Apple (SocialLogin/Signup leave this blank) —
		// there is no password to verify against, so "change" doesn't apply.
		// ForgotPassword still works for these accounts and sets one.
		c.JSON(http.StatusBadRequest, gin.H{"error": "This account signs in with Google or Apple — there's no password to change."})
		return
	}
	if reason := authpolicy.ValidatePassword(req.NewPassword, emp.Email); reason != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": reason})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(emp.PortalPasswordHash), []byte(req.CurrentPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Current password is incorrect"})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}
	h.db.Model(&models.Employee{}).Where("id = ?", emp.ID).Update("portal_password_hash", string(hashed))
	notifyEmployee(h.db, emp.OrgID, emp.ID, NotifPasswordChanged, "Your password was changed",
		"If you didn't do this, reset your password and contact your IT administrator.", "/dashboard/profile")

	mailer.PasswordChanged(emp.Email, emp.FirstName, true)

	c.JSON(http.StatusOK, gin.H{"message": "Password changed successfully"})
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

	// Blocked only. "Allowed" activity is neither stored nor reported
	// anywhere in the product, so a count of it could only ever be zero —
	// and a stat reading "0 allowed" is a claim about this employee's
	// traffic that happens to be false.
	var blockedCount int64
	if st, err := dataplane.Events(c.Request.Context(), emp.OrgID); err == nil {
		blockedCount, _ = st.CountEvents(c.Request.Context(), dataplane.EventQuery{
			OrgID: emp.OrgID, EmployeeID: &emp.ID, Since: time.Now().AddDate(0, 0, -7),
			Actions: dataplane.Strings(models.EventActionBlocked),
		})
	}

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
			"has_password":   emp.PortalPasswordHash != "",
		},
		"devices": devices,
		"stats_7d": gin.H{
			"blocked": blockedCount,
		},
	})
}

// ─── Installers ───────────────────────────────────────────────────────────────

// Installers handles GET /api/v1/portal/installers — the published native
// installer for every platform in one call, so the download page can render
// the right one immediately.
func (h *PortalHandler) Installers(c *gin.Context) {
	if _, ok := h.portalEmployee(c); !ok {
		return
	}
	version := ""
	pkgs := gin.H{}
	for _, osType := range []string{"macos", "windows", "linux"} {
		p := nativePackageJSON(c, osType)
		pkgs[osType] = p
		if p != nil && version == "" {
			version = p["version"].(string)
		}
	}
	c.Header("Cache-Control", "private, max-age=60")
	c.JSON(http.StatusOK, gin.H{"version": version, "packages": pkgs})
}

func nativePackageJSON(c *gin.Context, osType string) gin.H {
	name, url, version, sha256sum, size, found := NativePackageFor(c, osType)
	if !found {
		return nil
	}
	return gin.H{"filename": name, "url": url, "version": version, "size": size, "sha256": sha256sum}
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

// ─── Activity ─────────────────────────────────────────────────────────────────

// Activity handles GET /api/v1/portal/activity — the employee's own trail,
// with the same source tabs as the company dashboard. Each row carries what
// the employee can ask for on it ("access") and the state of that request.
func (h *PortalHandler) Activity(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
	search := strings.TrimSpace(c.Query("search"))
	days, _ := strconv.Atoi(c.Query("days"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 25
	}

	st, ok := eventStore(c, emp.OrgID.String())
	if !ok {
		return
	}
	q := portalEventScope(emp, days)
	if action := c.Query("action"); action != "" {
		q.Actions = splitCSV(action)
	}
	q.AnyOf = activitySourceScope(c.Query("source"))
	if search != "" {
		q.Search = search
		q.SearchFields = []string{"target_domain", "target", "category", "policy_name", "operation"}
	}

	ctx := c.Request.Context()
	total, err := st.CountEvents(ctx, q)
	if err != nil {
		respondStoreError(c, err)
		return
	}
	q.Offset, q.Limit = (page-1)*limit, limit
	events, err := st.FindEvents(ctx, q)
	if err != nil {
		respondStoreError(c, err)
		return
	}
	attachTargetApps(c.Request.Context(), emp.OrgID.String(), events)

	c.JSON(http.StatusOK, gin.H{
		"data":  h.withAccess(emp.ID, events),
		"total": total,
		"page":  page,
		"limit": limit,
		"pages": (total + int64(limit) - 1) / int64(limit),
	})
}

// portalEventScope is every stored row of this employee's in the window.
// "Allowed" traffic is never stored, and never shown.
func portalEventScope(emp *models.Employee, days int) dataplane.EventQuery {
	q := dataplane.EventQuery{
		OrgID:      emp.OrgID,
		EmployeeID: &emp.ID,
		NotActions: dataplane.Strings(models.EventActionAllowed),
	}
	if days > 0 {
		q.Since = time.Now().AddDate(0, 0, -days)
	}
	return q
}

// portalEvent is an activity row plus what its employee can do about it.
type portalEvent struct {
	models.ActivityEvent
	Access *portalAccess `json:"access,omitempty"`
}

type portalAccess struct {
	Kind      models.AccessRequestKind   `json:"kind"`
	Label     string                     `json:"label"`
	Status    models.AccessRequestStatus `json:"status,omitempty"`
	RequestID *uuid.UUID                 `json:"request_id,omitempty"`
	Note      string                     `json:"note,omitempty"`
}

// withAccess attaches, to each row that can be requested on, the latest
// request for the same thing — so a site blocked ten times shows "Access
// granted" on all ten rows once one request was approved.
func (h *PortalHandler) withAccess(empID uuid.UUID, events []models.ActivityEvent) []portalEvent {
	var requests []models.AccessRequest
	h.db.Where("employee_id = ?", empID).Order("created_at DESC").Find(&requests)
	latest := map[string]models.AccessRequest{}
	for _, r := range requests {
		k := string(r.Kind) + "|" + r.Resource
		if _, seen := latest[k]; !seen {
			latest[k] = r
		}
	}

	out := make([]portalEvent, len(events))
	for i := range events {
		out[i] = portalEvent{ActivityEvent: events[i]}
		t, ok := requestableFrom(&events[i])
		if !ok {
			continue
		}
		a := &portalAccess{Kind: t.Kind, Label: t.Label}
		if r, found := latest[string(t.Kind)+"|"+t.Resource]; found {
			id := r.ID
			a.Status, a.RequestID, a.Note = r.Status, &id, r.ReviewNote
		}
		out[i].Access = a
	}
	return out
}

// ActivityStats handles GET /api/v1/portal/activity/stats
func (h *PortalHandler) ActivityStats(c *gin.Context) {
	emp, ok := h.portalEmployee(c)
	if !ok {
		return
	}

	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	st, ok := eventStore(c, emp.OrgID.String())
	if !ok {
		return
	}
	ctx := c.Request.Context()
	scope := portalEventScope(emp, days)

	var blockedCount, alertedCount int64
	if groups, err := st.GroupEvents(ctx, scope, "action", 0); err == nil {
		for _, g := range groups {
			switch g.Key {
			case string(models.EventActionBlocked):
				blockedCount = g.Count
			case string(models.EventActionAlerted):
				alertedCount = g.Count
			}
		}
	} else {
		respondStoreError(c, err)
		return
	}

	// One count per tab, so the employee sees where their activity is.
	bySource := map[string]int64{}
	for _, src := range []string{"web_gateway", "dlp", "application", "malware", "device_posture", "device"} {
		q := scope
		q.AnyOf = activitySourceScope(src)
		n, _ := st.CountEvents(ctx, q)
		bySource[src] = n
	}

	requests := map[string]int64{}
	type statusCount struct {
		Status string
		N      int64
	}
	var sc []statusCount
	h.db.Model(&models.AccessRequest{}).Select("status, COUNT(*) AS n").
		Where("employee_id = ?", emp.ID).Group("status").Scan(&sc)
	for _, s := range sc {
		requests[s.Status] = s.N
	}

	// Most-blocked destinations and blocks per day, in one pass. Unlike the
	// counts above this always covers the last `days` days (default 7), as
	// it did when it was SQL.
	type DomainCount struct {
		Domain string `json:"domain"`
		Count  int    `json:"count"`
		Reason string `json:"reason"`
	}
	type DayCount struct {
		Date    string `json:"date"`
		Blocked int    `json:"blocked"`
	}
	blockedBy := map[string]*DomainCount{}
	perDay := map[string]*DayCount{}
	pass := dataplane.EventQuery{
		OrgID: emp.OrgID, EmployeeID: &emp.ID, Since: time.Now().AddDate(0, 0, -days),
		Fields: []string{"action", "target", "target_domain", "policy_name", "timestamp"}, Ascending: true,
	}
	if err := st.EachEvent(ctx, pass, func(ev *models.ActivityEvent) error {
		day := ev.Timestamp.UTC().Format("2006-01-02")
		d := perDay[day]
		if d == nil {
			d = &DayCount{Date: day}
			perDay[day] = d
		}
		if ev.Action != models.EventActionBlocked {
			return nil
		}
		d.Blocked++
		dest := ev.TargetDomain
		if dest == "" {
			dest = ev.Target
		}
		if dest == "" {
			return nil
		}
		dc := blockedBy[dest]
		if dc == nil {
			dc = &DomainCount{Domain: dest}
			blockedBy[dest] = dc
		}
		dc.Count++
		if ev.PolicyName > dc.Reason { // MAX(policy_name), as before
			dc.Reason = ev.PolicyName
		}
		return nil
	}); err != nil {
		respondStoreError(c, err)
		return
	}
	topBlocked := make([]DomainCount, 0, len(blockedBy))
	for _, d := range blockedBy {
		topBlocked = append(topBlocked, *d)
	}
	sort.Slice(topBlocked, func(i, j int) bool {
		if topBlocked[i].Count != topBlocked[j].Count {
			return topBlocked[i].Count > topBlocked[j].Count
		}
		return topBlocked[i].Domain < topBlocked[j].Domain
	})
	if len(topBlocked) > 10 {
		topBlocked = topBlocked[:10]
	}
	byDay := make([]DayCount, 0, len(perDay))
	for _, d := range perDay {
		byDay = append(byDay, *d)
	}
	sort.Slice(byDay, func(i, j int) bool { return byDay[i].Date < byDay[j].Date })

	c.JSON(http.StatusOK, gin.H{
		"blocked":     blockedCount,
		"alerted":     alertedCount,
		"by_source":   bySource,
		"requests":    requests,
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

