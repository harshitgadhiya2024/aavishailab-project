package handlers

import (
	"net/http"
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

// MFAHandler owns two-factor enrolment and verification.
//
// The design principle throughout: a second factor must not become a way to
// lose an account. Enrolment isn't active until the user proves they can
// generate a code, recovery codes are issued at that moment, and disabling
// always requires the password.
type MFAHandler struct {
	db *gorm.DB
}

func NewMFAHandler(db *gorm.DB) *MFAHandler { return &MFAHandler{db: db} }

const recoveryCodeCount = 8

func (h *MFAHandler) currentUser(c *gin.Context) (*models.User, bool) {
	raw, exists := c.Get(middleware.ContextKeyUserID)
	uid, ok := raw.(uuid.UUID)
	if !exists || !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not signed in"})
		return nil, false
	}
	var user models.User
	if err := h.db.Preload("Org").First(&user, "id = ?", uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return nil, false
	}
	return &user, true
}

// Status handles GET /auth/mfa/status
func (h *MFAHandler) Status(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}

	var unused int64
	h.db.Model(&models.MFARecoveryCode{}).
		Where("user_id = ? AND used_at IS NULL", user.ID).Count(&unused)

	c.JSON(http.StatusOK, gin.H{
		"enabled":             user.MFAEnabled,
		"enrolled_at":         user.MFAEnrolledAt,
		"recovery_codes_left": unused,
		"required_by_org":     orgRequiresMFA(h.db, user.OrgID),
		"setup_pending":       !user.MFAEnabled && user.MFASecret != "",
	})
}

// orgRequiresMFA reads the org-wide policy. An org can insist every dashboard
// user has a second factor; the login flow then refuses to hand out tokens
// until they enrol.
func orgRequiresMFA(db *gorm.DB, orgID *uuid.UUID) bool {
	if orgID == nil {
		return false
	}
	var org models.Organization
	if err := db.First(&org, "id = ?", *orgID).Error; err != nil {
		return false
	}
	required, _ := org.Settings["mfa_required"].(bool)
	return required
}

// Setup handles POST /auth/mfa/setup — issues a secret and the QR payload.
// Nothing is enabled yet: the secret is parked on the user until a code proves
// their authenticator has it.
func (h *MFAHandler) Setup(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}
	if user.MFAEnabled {
		c.JSON(http.StatusConflict, gin.H{"error": "Two-factor authentication is already on. Turn it off first to re-enrol."})
		return
	}

	secret, err := auth.GenerateTOTPSecret()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not start setup"})
		return
	}
	h.db.Model(user).Update("mfa_secret", secret)

	issuer := "Delsecure"
	if user.Org != nil && user.Org.Name != "" {
		issuer = "Delsecure (" + user.Org.Name + ")"
	}

	c.JSON(http.StatusOK, gin.H{
		"secret":           secret,
		"provisioning_uri": auth.TOTPProvisioningURI(secret, user.Email, issuer),
		"account":          user.Email,
		"issuer":           issuer,
		"instructions":     "Scan the QR code in an authenticator app, then enter the 6-digit code it shows to finish.",
	})
}

// Enable handles POST /auth/mfa/enable — confirms the first code and returns
// the recovery codes, which are shown exactly once.
func (h *MFAHandler) Enable(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}
	if user.MFAEnabled {
		c.JSON(http.StatusConflict, gin.H{"error": "Two-factor authentication is already on"})
		return
	}
	if user.MFASecret == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Start setup first"})
		return
	}

	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !auth.VerifyTOTP(user.MFASecret, req.Code) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That code didn't match. Check your authenticator app's clock and try the current code."})
		return
	}

	now := time.Now()
	h.db.Model(user).Updates(map[string]any{"mfa_enabled": true, "mfa_enrolled_at": now})

	codes, err := h.issueRecoveryCodes(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Enabled, but recovery codes could not be generated"})
		return
	}

	mailer.MFAEnabled(user.Email, user.FirstName)

	c.JSON(http.StatusOK, gin.H{
		"enabled":        true,
		"recovery_codes": codes,
		"note":           "Save these somewhere safe. Each one works once, and they are not shown again.",
	})
}

// issueRecoveryCodes replaces any existing codes with a fresh set.
func (h *MFAHandler) issueRecoveryCodes(userID uuid.UUID) ([]string, error) {
	codes, err := auth.GenerateRecoveryCodes(recoveryCodeCount)
	if err != nil {
		return nil, err
	}
	h.db.Where("user_id = ?", userID).Delete(&models.MFARecoveryCode{})
	for _, code := range codes {
		if err := h.db.Create(&models.MFARecoveryCode{
			UserID:   userID,
			CodeHash: auth.HashRecoveryCode(code),
		}).Error; err != nil {
			return nil, err
		}
	}
	return codes, nil
}

// RegenerateRecoveryCodes handles POST /auth/mfa/recovery-codes
func (h *MFAHandler) RegenerateRecoveryCodes(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}
	if !user.MFAEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Two-factor authentication is not on"})
		return
	}

	// The password is required: whoever holds a live session shouldn't be able
	// to mint themselves a fresh way in without proving who they are.
	var req struct {
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "That password is incorrect"})
		return
	}

	codes, err := h.issueRecoveryCodes(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not generate new codes"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"recovery_codes": codes, "note": "Your previous codes no longer work."})
}

// Disable handles POST /auth/mfa/disable
func (h *MFAHandler) Disable(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}

	var req struct {
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "That password is incorrect"})
		return
	}

	// If the organization mandates MFA, a user turning it off would just be
	// locked out at the next sign-in — so refuse and say why.
	if orgRequiresMFA(h.db, user.OrgID) {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Your organization requires two-factor authentication. An administrator must turn off the requirement first.",
		})
		return
	}

	h.db.Model(user).Updates(map[string]any{
		"mfa_enabled":     false,
		"mfa_secret":      "",
		"mfa_enrolled_at": nil,
	})
	h.db.Where("user_id = ?", user.ID).Delete(&models.MFARecoveryCode{})

	mailer.MFADisabled(user.Email, user.FirstName)

	c.JSON(http.StatusOK, gin.H{"enabled": false, "message": "Two-factor authentication turned off"})
}

// Verify handles POST /auth/mfa/verify — the second step of signing in. It
// takes the challenge token from the password step plus a TOTP or recovery
// code, and only then issues real session tokens.
func (h *MFAHandler) Verify(c *gin.Context) {
	var req struct {
		MFAToken string `json:"mfa_token" binding:"required"`
		Code     string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, err := auth.ParseMFAChallenge(req.MFAToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "This sign-in attempt expired. Enter your email and password again.",
			"code":  "MFA_CHALLENGE_EXPIRED",
		})
		return
	}

	var user models.User
	if err := h.db.Preload("Org").First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid sign-in attempt"})
		return
	}
	if user.Status != models.StatusActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is " + string(user.Status)})
		return
	}

	usedRecoveryCode := false
	if !auth.VerifyTOTP(user.MFASecret, req.Code) {
		if !h.consumeRecoveryCode(user.ID, req.Code) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "That code is not valid"})
			return
		}
		usedRecoveryCode = true
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
	if err := h.db.Create(&models.RefreshToken{
		UserID:     user.ID,
		TokenHash:  hashedRefresh,
		ExpiresAt:  auth.RefreshExpiry(),
		IPAddress:  c.ClientIP(),
		DeviceInfo: c.GetHeader("User-Agent"),
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store refresh token"})
		return
	}
	h.db.Model(&user).Update("last_login_at", time.Now())

	resp := buildAuthResponseWithAccess(h.db, &user, accessToken, plainRefresh)
	payload := gin.H{
		"access_token":  resp.AccessToken,
		"refresh_token": resp.RefreshToken,
		"expires_in":    resp.ExpiresIn,
		"user":          resp.User,
	}

	if usedRecoveryCode {
		var left int64
		h.db.Model(&models.MFARecoveryCode{}).
			Where("user_id = ? AND used_at IS NULL", user.ID).Count(&left)
		payload["used_recovery_code"] = true
		payload["recovery_codes_left"] = left
		// Someone signing in with a recovery code has either lost their device
		// or isn't the account holder. Both are worth an email.
		mailer.MFARecoveryCodeUsed(user.Email, user.FirstName, int(left), c.ClientIP())
	}

	c.JSON(http.StatusOK, payload)
}

// consumeRecoveryCode marks a matching unused code as spent, in one atomic
// update so the same code can't be redeemed twice concurrently.
func (h *MFAHandler) consumeRecoveryCode(userID uuid.UUID, code string) bool {
	normalized := auth.NormalizeRecoveryCode(code)
	if normalized == "" {
		return false
	}
	result := h.db.Model(&models.MFARecoveryCode{}).
		Where("user_id = ? AND code_hash = ? AND used_at IS NULL", userID, auth.HashRecoveryCode(normalized)).
		Update("used_at", time.Now())
	return result.RowsAffected == 1
}

// ─── Organization-wide requirement ────────────────────────────────────────────

// GetOrgPolicy handles GET /settings/mfa
func (h *MFAHandler) GetOrgPolicy(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}
	required, _ := org.Settings["mfa_required"].(bool)

	type userMFA struct {
		ID         uuid.UUID `json:"id"`
		Email      string    `json:"email"`
		Role       string    `json:"role"`
		MFAEnabled bool      `json:"mfa_enabled"`
	}
	var users []userMFA
	h.db.Model(&models.User{}).
		Select("id, email, role, mfa_enabled").
		Where("org_id = ?", orgID).
		Order("mfa_enabled ASC, email ASC").
		Scan(&users)

	enrolled := 0
	for _, u := range users {
		if u.MFAEnabled {
			enrolled++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"required":       required,
		"users":          users,
		"total_users":    len(users),
		"enrolled_users": enrolled,
	})
}

// SetOrgPolicy handles PUT /settings/mfa — turn the requirement on or off.
func (h *MFAHandler) SetOrgPolicy(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	var req struct {
		Required bool `json:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Turning the requirement on while the person doing it has no second factor
	// would lock them out on their next sign-in. Make them enrol first.
	if req.Required {
		if raw, exists := c.Get(middleware.ContextKeyUserID); exists {
			if uid, ok := raw.(uuid.UUID); ok {
				var me models.User
				if err := h.db.First(&me, "id = ?", uid).Error; err == nil && !me.MFAEnabled {
					c.JSON(http.StatusBadRequest, gin.H{
						"error": "Set up two-factor authentication on your own account before requiring it for everyone.",
					})
					return
				}
			}
		}
	}

	if org.Settings == nil {
		org.Settings = map[string]any{}
	}
	org.Settings["mfa_required"] = req.Required
	if err := h.db.Model(&org).Update("settings", org.Settings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save the setting"})
		return
	}

	// Everyone who still needs to enrol is told, rather than discovering it at
	// their next sign-in.
	if req.Required {
		var pending []models.User
		h.db.Where("org_id = ? AND status = ? AND mfa_enabled = false", orgID, models.StatusActive).Find(&pending)
		for _, u := range pending {
			mailer.MFARequired(u.Email, u.FirstName, org.Name)
		}
	}

	c.JSON(http.StatusOK, gin.H{"required": req.Required})
}
