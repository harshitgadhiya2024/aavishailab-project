package handlers

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/auth"
	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type AuthHandler struct {
	db *gorm.DB
}

func NewAuthHandler(db *gorm.DB) *AuthHandler {
	return &AuthHandler{db: db}
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
	Panel    string `json:"panel"` // "superadmin" or "company"
}

type AuthResponse struct {
	AccessToken  string   `json:"access_token"`
	RefreshToken string   `json:"refresh_token"`
	ExpiresIn    int      `json:"expires_in"` // seconds
	User         *UserDTO `json:"user"`
}

type UserDTO struct {
	ID        uuid.UUID         `json:"id"`
	Email     string            `json:"email"`
	FirstName string            `json:"first_name"`
	LastName  string            `json:"last_name"`
	FullName  string            `json:"full_name"`
	Role      models.UserRole   `json:"role"`
	Status    models.UserStatus `json:"status"`
	AvatarURL string            `json:"avatar_url"`
	OrgID     *uuid.UUID        `json:"org_id"`
	Org       *OrgSummary       `json:"org,omitempty"`
	// What this user may do, and (for a manager) whose people they may see.
	Permissions []string    `json:"permissions,omitempty"`
	TeamIDs     []uuid.UUID `json:"team_ids,omitempty"`
	MFAEnabled  bool        `json:"mfa_enabled"`
	// SuperAdminLevel only means anything for Role == superadmin.
	SuperAdminLevel models.SuperAdminLevel `json:"superadmin_level,omitempty"`
}

type OrgSummary struct {
	ID     uuid.UUID `json:"id"`
	Name   string    `json:"name"`
	Slug   string    `json:"slug"`
	Plan   string    `json:"plan"`
	Status string    `json:"status"`
}

// Login handles POST /auth/login
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Find user by email
	var user models.User
	query := h.db.Where("email = ?", req.Email)

	// For company panel, only find org users
	if req.Panel == "company" {
		query = query.Where("org_id IS NOT NULL")
	} else if req.Panel == "superadmin" {
		query = query.Where("role = ?", models.RoleSuperAdmin)
	}

	if err := query.Preload("Org").First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	// Check password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	// Check status
	if user.Status != models.StatusActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is " + string(user.Status)})
		return
	}

	// Second factor, if the account has one. No session tokens are issued here —
	// the challenge only certifies that the password step passed.
	if user.MFAEnabled && user.MFASecret != "" {
		challenge, chErr := auth.GenerateMFAChallenge(&user)
		if chErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start verification"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"mfa_required": true,
			"mfa_token":    challenge,
			"code":         "MFA_REQUIRED",
			"message":      "Enter the 6-digit code from your authenticator app.",
		})
		return
	}

	// No authenticator app: prove the address instead. Every sign-in gets a
	// second step — the difference is only which one.
	if !orgRequiresMFA(h.db, user.OrgID) {
		challenge, chErr := auth.GenerateMFAChallenge(&user)
		if chErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start verification"})
			return
		}
		if err := NewOTPHandler(h.db).SendLoginOTP(&user, c.ClientIP()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not send your sign-in code"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"otp_required": true,
			"otp_token":    challenge,
			"code":         "OTP_REQUIRED",
			"email":        maskEmail(user.Email),
			"message":      "We've emailed you a 6-digit sign-in code.",
		})
		return
	}

	// An organization can insist on a second factor. Rather than letting the
	// user in without one, say plainly that enrolment is the next step — the
	// dashboard sends them to the setup screen with this token.
	if orgRequiresMFA(h.db, user.OrgID) {
		challenge, chErr := auth.GenerateMFAChallenge(&user)
		if chErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start enrolment"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"mfa_setup_required": true,
			"mfa_token":          challenge,
			"code":               "MFA_SETUP_REQUIRED",
			"message":            "Your organization requires two-factor authentication. Set it up to continue.",
		})
		return
	}

	// Generate tokens
	accessToken, _, err := auth.GenerateAccessToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	plainRefresh, hashedRefresh, err := auth.GenerateRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
		return
	}

	// Store refresh token
	rt := models.RefreshToken{
		UserID:     user.ID,
		TokenHash:  hashedRefresh,
		ExpiresAt:  auth.RefreshExpiry(),
		IPAddress:  c.ClientIP(),
		DeviceInfo: c.GetHeader("User-Agent"),
	}
	if err := h.db.Create(&rt).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store refresh token"})
		return
	}

	// Update last login
	h.db.Model(&user).Update("last_login_at", time.Now())

	resp := buildAuthResponseWithAccess(h.db, &user, accessToken, plainRefresh)
	c.JSON(http.StatusOK, resp)
}

// RegisterRequest is the self-service company signup payload
type RegisterRequest struct {
	CompanyName string `json:"company_name" binding:"required"`
	FirstName   string `json:"first_name" binding:"required"`
	LastName    string `json:"last_name" binding:"required"`
	Email       string `json:"email" binding:"required,email"`
	Password    string `json:"password" binding:"required,min=8"`
}

// Register handles POST /auth/register — creates a new organization plus its
// first org_admin user, and logs them in immediately (self-service SaaS signup).
func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var existing int64
	h.db.Model(&models.User{}).Where("email = ?", req.Email).Count(&existing)
	if existing > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "An account with this email already exists"})
		return
	}

	base := slugify(req.CompanyName)
	if base == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please enter a valid company name"})
		return
	}
	slug := base
	for i := 2; ; i++ {
		var count int64
		h.db.Model(&models.Organization{}).Where("slug = ?", slug).Count(&count)
		if count == 0 {
			break
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	trialEnd := time.Now().AddDate(0, 0, 14)
	var user models.User
	err = h.db.Transaction(func(tx *gorm.DB) error {
		org := models.Organization{
			Name:        req.CompanyName,
			Slug:        slug,
			Status:      models.OrgStatusTrial,
			Plan:        models.PlanTrial,
			MaxUsers:    50,
			TrialEndsAt: &trialEnd,
		}
		if err := tx.Create(&org).Error; err != nil {
			return err
		}
		user = models.User{
			OrgID:        &org.ID,
			Email:        req.Email,
			PasswordHash: string(hashed),
			FirstName:    req.FirstName,
			LastName:     req.LastName,
			Role:         models.RoleOrgAdmin,
			Status:       models.StatusActive,
		}
		return tx.Create(&user).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create organization"})
		return
	}

	h.db.Preload("Org").First(&user, "id = ?", user.ID)

	accessToken, _, err := auth.GenerateAccessToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	plainRefresh, hashedRefresh, err := auth.GenerateRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
		return
	}

	rt := models.RefreshToken{
		UserID:     user.ID,
		TokenHash:  hashedRefresh,
		ExpiresAt:  auth.RefreshExpiry(),
		IPAddress:  c.ClientIP(),
		DeviceInfo: c.GetHeader("User-Agent"),
	}
	h.db.Create(&rt)

	orgName := req.CompanyName
	if user.Org != nil {
		orgName = user.Org.Name
	}
	mailer.WelcomeOrg(user.Email, user.FirstName, orgName)

	c.JSON(http.StatusCreated, buildAuthResponseWithAccess(h.db, &user, accessToken, plainRefresh))
}

// Refresh handles POST /auth/refresh
func (h *AuthHandler) Refresh(c *gin.Context) {
	type RefreshRequest struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashed := auth.HashRefreshToken(req.RefreshToken)

	// Find the refresh token, accepting one that was rotated a moment ago.
	// Several tabs (or several in-flight API calls) hit refresh at the same
	// instant with the same token; without this window the first request wins
	// and every other one gets logged out.
	var rt models.RefreshToken
	if err := h.db.Where("token_hash = ? AND expires_at > ?", hashed, time.Now()).
		First(&rt).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired refresh token"})
		return
	}
	if rt.Revoked && !withinRotationGrace(rt.RevokedAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired refresh token"})
		return
	}

	// Load user
	var user models.User
	if err := h.db.Preload("Org").First(&user, "id = ?", rt.UserID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
		return
	}

	if user.Status != models.StatusActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account suspended"})
		return
	}

	// Rotate: revoke old, issue new
	if !rt.Revoked {
		now := time.Now()
		h.db.Model(&rt).Updates(map[string]any{"revoked": true, "revoked_at": now})
	}

	accessToken, _, err := auth.GenerateAccessToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	plainRefresh, hashedRefresh, err := auth.GenerateRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
		return
	}

	newRT := models.RefreshToken{
		UserID:     user.ID,
		TokenHash:  hashedRefresh,
		ExpiresAt:  auth.RefreshExpiry(),
		IPAddress:  c.ClientIP(),
		DeviceInfo: c.GetHeader("User-Agent"),
	}
	h.db.Create(&newRT)

	resp := buildAuthResponse(&user, accessToken, plainRefresh)
	c.JSON(http.StatusOK, resp)
}

// Logout handles POST /auth/logout
func (h *AuthHandler) Logout(c *gin.Context) {
	type LogoutRequest struct {
		RefreshToken string `json:"refresh_token"`
	}
	var req LogoutRequest
	_ = c.ShouldBindJSON(&req)

	if req.RefreshToken != "" {
		hashed := auth.HashRefreshToken(req.RefreshToken)
		h.db.Where("token_hash = ?", hashed).Delete(&models.RefreshToken{})
	}

	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

// Me handles GET /auth/me
func (h *AuthHandler) Me(c *gin.Context) {
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	var user models.User
	if err := h.db.Preload("Org").First(&user, "id = ?", uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	dto := toUserDTO(&user)
	dto.Permissions, dto.TeamIDs = userAccess(h.db, &user)
	c.JSON(http.StatusOK, dto)
}

// ChangePassword handles POST /auth/change-password
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	type ChangePassReq struct {
		CurrentPassword string `json:"current_password" binding:"required"`
		NewPassword     string `json:"new_password" binding:"required,min=8"`
	}
	var req ChangePassReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	var user models.User
	if err := h.db.First(&user, "id = ?", uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Current password is incorrect"})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	h.db.Model(&user).Update("password_hash", string(hashed))

	// Revoke all refresh tokens to force re-login on other devices
	h.db.Where("user_id = ?", uid).Delete(&models.RefreshToken{})

	mailer.PasswordChanged(user.Email, user.FirstName, false)

	c.JSON(http.StatusOK, gin.H{"message": "Password changed successfully"})
}

// UpdateProfile handles PUT /auth/profile
func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	type ProfileReq struct {
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		Phone     string `json:"phone"`
		AvatarURL string `json:"avatar_url"`
	}
	var req ProfileReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	updates := map[string]any{}
	if req.FirstName != "" {
		updates["first_name"] = req.FirstName
	}
	if req.LastName != "" {
		updates["last_name"] = req.LastName
	}
	if req.Phone != "" {
		updates["phone"] = req.Phone
	}
	if req.AvatarURL != "" {
		updates["avatar_url"] = req.AvatarURL
	}

	h.db.Model(&models.User{}).Where("id = ?", uid).Updates(updates)

	var user models.User
	h.db.Preload("Org").First(&user, "id = ?", uid)
	c.JSON(http.StatusOK, toUserDTO(&user))
}

// ForgotPassword handles POST /auth/forgot-password — always returns a generic
// message (no user enumeration). The link goes out by email; outside production
// the raw token is also returned so a developer without SMTP can still test.
func (h *AuthHandler) ForgotPassword(c *gin.Context) {
	var req struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp := gin.H{"message": "If an account exists for that email, reset instructions have been sent."}

	var user models.User
	if err := h.db.Where("email = ?", req.Email).First(&user).Error; err == nil {
		plain, hashed, genErr := auth.GenerateRefreshToken()
		if genErr == nil {
			h.db.Create(&models.PasswordResetToken{
				UserID:    &user.ID,
				TokenHash: hashed,
				ExpiresAt: time.Now().Add(1 * time.Hour),
			})
			mailer.PasswordReset(user.Email, user.FirstName, plain, false)
			if os.Getenv("APP_ENV") != "production" && !mailer.Enabled() {
				resp["reset_token"] = plain
				resp["dev_note"] = "SMTP is not configured — this token is only returned outside production."
			}
		}
	}

	c.JSON(http.StatusOK, resp)
}

// ResetPassword handles POST /auth/reset-password
func (h *AuthHandler) ResetPassword(c *gin.Context) {
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
	if err := h.db.Where("token_hash = ? AND used = false AND expires_at > ? AND user_id IS NOT NULL", hashed, time.Now()).
		First(&prt).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid or expired reset link"})
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	h.db.Model(&models.User{}).Where("id = ?", *prt.UserID).Update("password_hash", string(newHash))
	h.db.Model(&prt).Update("used", true)
	h.db.Where("user_id = ?", *prt.UserID).Delete(&models.RefreshToken{})

	// Tell the account holder their password changed — if it wasn't them, this
	// email is the only warning they get.
	var user models.User
	if err := h.db.First(&user, "id = ?", *prt.UserID).Error; err == nil {
		mailer.PasswordChanged(user.Email, user.FirstName, false)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Password reset successfully"})
}

// SocialLogin handles POST /auth/social — called server-side by NextAuth after
// it has already verified the Google/Apple identity token. Only logs in an
// existing user by verified email; it never creates accounts, and it's gated
// behind a shared internal secret so it can't be used as an open login backdoor.
func (h *AuthHandler) SocialLogin(c *gin.Context) {
	if !validInternalSecret(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	var req struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := h.db.Where("email = ? AND org_id IS NOT NULL", req.Email).Preload("Org").First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No account found for this email. Please register first."})
		return
	}
	if user.Status != models.StatusActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is " + string(user.Status)})
		return
	}

	accessToken, _, err := auth.GenerateAccessToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	plainRefresh, hashedRefresh, err := auth.GenerateRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate refresh token"})
		return
	}
	h.db.Create(&models.RefreshToken{
		UserID:     user.ID,
		TokenHash:  hashedRefresh,
		ExpiresAt:  auth.RefreshExpiry(),
		IPAddress:  c.ClientIP(),
		DeviceInfo: c.GetHeader("User-Agent"),
	})
	h.db.Model(&user).Update("last_login_at", time.Now())

	c.JSON(http.StatusOK, buildAuthResponse(&user, accessToken, plainRefresh))
}

// validInternalSecret checks the X-Internal-Secret header against
// INTERNAL_API_SECRET. Fails closed: an unset secret always denies.
func validInternalSecret(c *gin.Context) bool {
	expected := os.Getenv("INTERNAL_API_SECRET")
	if expected == "" {
		return false
	}
	return c.GetHeader("X-Internal-Secret") == expected
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// rotationGrace is how long an already-rotated refresh token keeps working.
// Long enough to absorb a burst of parallel requests refreshing at once,
// short enough that a genuinely stolen-and-replayed token still fails.
const rotationGrace = 60 * time.Second

func withinRotationGrace(revokedAt *time.Time) bool {
	if revokedAt == nil {
		return false
	}
	return time.Since(*revokedAt) <= rotationGrace
}

func buildAuthResponse(user *models.User, accessToken, refreshToken string) *AuthResponse {
	return &AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    15 * 60, // 15 minutes in seconds
		User:         toUserDTO(user),
	}
}

// buildAuthResponseWithAccess is buildAuthResponse plus the permission list, so
// a freshly signed-in dashboard knows what to render without a second call.
func buildAuthResponseWithAccess(db *gorm.DB, user *models.User, accessToken, refreshToken string) *AuthResponse {
	resp := buildAuthResponse(user, accessToken, refreshToken)
	resp.User.Permissions, resp.User.TeamIDs = userAccess(db, user)
	return resp
}

// Permissions and team scope travel with the profile: the dashboard decides
// what to render from these, and the API enforces the same list server-side.
func userAccess(db *gorm.DB, user *models.User) (perms []string, teamIDs []uuid.UUID) {
	perms = models.PermissionsForRole(user.Role)
	teamIDs = []uuid.UUID{}
	if user.Role == models.RoleManager {
		var links []models.UserTeam
		db.Where("user_id = ?", user.ID).Find(&links)
		for _, l := range links {
			teamIDs = append(teamIDs, l.TeamID)
		}
	}
	return perms, teamIDs
}

func toUserDTO(user *models.User) *UserDTO {
	dto := &UserDTO{
		ID:         user.ID,
		Email:      user.Email,
		FirstName:  user.FirstName,
		LastName:   user.LastName,
		FullName:   user.FullName(),
		Role:       user.Role,
		Status:     user.Status,
		AvatarURL:  user.AvatarURL,
		OrgID:      user.OrgID,
		MFAEnabled: user.MFAEnabled,
	}
	if user.Role == models.RoleSuperAdmin {
		dto.SuperAdminLevel = user.SuperAdminLevel
		if dto.SuperAdminLevel == "" {
			dto.SuperAdminLevel = models.SuperAdminLevelFull
		}
	}
	if user.Org != nil {
		dto.Org = &OrgSummary{
			ID:     user.Org.ID,
			Name:   user.Org.Name,
			Slug:   user.Org.Slug,
			Plan:   string(user.Org.Plan),
			Status: string(user.Org.Status),
		}
	}
	return dto
}

// maskEmail shows enough of an address to recognise it ("ha•••@gmail.com")
// without printing it in full on a screen someone else might be looking at.
func maskEmail(email string) string {
	at := strings.Index(email, "@")
	if at <= 0 {
		return email
	}
	name, domain := email[:at], email[at:]
	if len(name) <= 2 {
		return name[:1] + "•••" + domain
	}
	return name[:2] + "•••" + domain
}
