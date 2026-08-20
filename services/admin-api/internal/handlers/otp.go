package handlers

import (
	"fmt"
	"net/http"
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

// OTPHandler owns the email one-time-code half of authentication:
//
//   - sign-in, for accounts without an authenticator app
//   - registration, where the code proves the address before any organization
//     is created
//
// A code is single-use, expires, counts attempts, and is bound to a purpose —
// a registration code can never finish someone's sign-in.
type OTPHandler struct {
	db *gorm.DB
}

func NewOTPHandler(db *gorm.DB) *OTPHandler { return &OTPHandler{db: db} }

// resendCooldown stops "resend" from becoming a way to spray someone's inbox.
const resendCooldown = 45 * time.Second

// issueOTP mints a code, stores its hash and returns the plaintext for sending.
// Any earlier unused code for the same address and purpose is retired first, so
// only the newest email ever works — otherwise a user with three codes in their
// inbox has to guess which one is live.
func (h *OTPHandler) issueOTP(email string, purpose models.OTPPurpose, userID *uuid.UUID, payload map[string]any, ip string) (string, *models.EmailOTP, error) {
	email = strings.ToLower(strings.TrimSpace(email))

	now := time.Now()
	h.db.Model(&models.EmailOTP{}).
		Where("email = ? AND purpose = ? AND consumed_at IS NULL", email, purpose).
		Update("consumed_at", now)

	code, err := auth.GenerateOTPCode()
	if err != nil {
		return "", nil, err
	}

	otp := models.EmailOTP{
		Email:     email,
		CodeHash:  auth.HashOTP(code),
		Purpose:   purpose,
		UserID:    userID,
		Payload:   payload,
		ExpiresAt: now.Add(models.OTPValidity),
		IPAddress: ip,
	}
	if err := h.db.Create(&otp).Error; err != nil {
		return "", nil, err
	}
	return code, &otp, nil
}

// consumeOTP validates a submitted code. The failure reasons are deliberately
// distinct in the logs but uniform to the caller, apart from the two a user can
// actually act on: expired, and out of attempts.
func (h *OTPHandler) consumeOTP(email string, purpose models.OTPPurpose, code string) (*models.EmailOTP, error) {
	email = strings.ToLower(strings.TrimSpace(email))

	var otp models.EmailOTP
	err := h.db.Where("email = ? AND purpose = ? AND consumed_at IS NULL", email, purpose).
		Order("created_at DESC").First(&otp).Error
	if err != nil {
		return nil, fmt.Errorf("no code pending for this address — request a new one")
	}
	if time.Now().After(otp.ExpiresAt) {
		return nil, fmt.Errorf("that code has expired — request a new one")
	}
	if otp.Attempts >= models.MaxOTPAttempts {
		return nil, fmt.Errorf("too many incorrect attempts — request a new code")
	}

	if otp.CodeHash != auth.HashOTP(code) {
		h.db.Model(&otp).Update("attempts", otp.Attempts+1)
		left := models.MaxOTPAttempts - (otp.Attempts + 1)
		if left <= 0 {
			return nil, fmt.Errorf("too many incorrect attempts — request a new code")
		}
		return nil, fmt.Errorf("that code is not correct (%d attempt%s left)", left, map[bool]string{true: "", false: "s"}[left == 1])
	}

	// Marked consumed in a conditional update so two racing submissions of the
	// same code can't both succeed.
	now := time.Now()
	result := h.db.Model(&models.EmailOTP{}).
		Where("id = ? AND consumed_at IS NULL", otp.ID).
		Update("consumed_at", now)
	if result.RowsAffected != 1 {
		return nil, fmt.Errorf("that code has already been used")
	}
	return &otp, nil
}

// ─── Sign-in with an emailed code ─────────────────────────────────────────────

// SendLoginOTP issues and emails the sign-in code. Called by the login handler
// once the password checks out, so it is never a way to probe for accounts.
func (h *OTPHandler) SendLoginOTP(user *models.User, ip string) error {
	code, _, err := h.issueOTP(user.Email, models.OTPPurposeLogin, &user.ID, nil, ip)
	if err != nil {
		return err
	}
	mailer.LoginCode(user.Email, user.FirstName, code, int(models.OTPValidity.Minutes()))
	return nil
}

// VerifyLogin handles POST /auth/otp/verify — the second step for accounts
// without an authenticator app.
func (h *OTPHandler) VerifyLogin(c *gin.Context) {
	var req struct {
		Token string `json:"otp_token" binding:"required"`
		Code  string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, err := auth.ParseMFAChallenge(req.Token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "This sign-in attempt expired. Enter your email and password again.",
			"code":  "OTP_CHALLENGE_EXPIRED",
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

	if _, err := h.consumeOTP(user.Email, models.OTPPurposeLogin, req.Code); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	resp, err := issueSession(h.db, &user, c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// ResendLogin handles POST /auth/otp/resend
func (h *OTPHandler) ResendLogin(c *gin.Context) {
	var req struct {
		Token string `json:"otp_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, err := auth.ParseMFAChallenge(req.Token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "This sign-in attempt expired. Enter your email and password again.",
			"code":  "OTP_CHALLENGE_EXPIRED",
		})
		return
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid sign-in attempt"})
		return
	}

	if wait, ok := h.cooldownRemaining(user.Email, models.OTPPurposeLogin); !ok {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": fmt.Sprintf("A code was just sent. Try again in %d seconds.", wait),
		})
		return
	}

	if err := h.SendLoginOTP(&user, c.ClientIP()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not send the code"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"sent": true, "message": "A new code is on its way."})
}

// cooldownRemaining reports whether enough time has passed to send again.
func (h *OTPHandler) cooldownRemaining(email string, purpose models.OTPPurpose) (int, bool) {
	var last models.EmailOTP
	if err := h.db.Where("email = ? AND purpose = ?", strings.ToLower(email), purpose).
		Order("created_at DESC").First(&last).Error; err != nil {
		return 0, true
	}
	elapsed := time.Since(last.CreatedAt)
	if elapsed >= resendCooldown {
		return 0, true
	}
	return int((resendCooldown - elapsed).Seconds()) + 1, false
}

// ─── Registration ─────────────────────────────────────────────────────────────

// StartRegistration handles POST /auth/register/start.
//
// Nothing is written to users or organizations here: the signup details ride
// along on the OTP row, and the account is only created once the address has
// been proven. That keeps unverified organizations out of the database
// entirely, rather than needing a cleanup job for them later.
func (h *OTPHandler) StartRegistration(c *gin.Context) {
	var req struct {
		CompanyName string `json:"company_name" binding:"required"`
		FirstName   string `json:"first_name" binding:"required"`
		LastName    string `json:"last_name"`
		Email       string `json:"email" binding:"required,email"`
		Password    string `json:"password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))

	var existing int64
	h.db.Model(&models.User{}).Where("LOWER(email) = ?", email).Count(&existing)
	if existing > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "An account with this email already exists"})
		return
	}

	if wait, ok := h.cooldownRemaining(email, models.OTPPurposeRegister); !ok {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": fmt.Sprintf("A code was just sent. Try again in %d seconds.", wait),
		})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to secure the password"})
		return
	}

	code, _, err := h.issueOTP(email, models.OTPPurposeRegister, nil, map[string]any{
		"company_name":  strings.TrimSpace(req.CompanyName),
		"first_name":    strings.TrimSpace(req.FirstName),
		"last_name":     strings.TrimSpace(req.LastName),
		"password_hash": string(hashed),
	}, c.ClientIP())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not start registration"})
		return
	}

	mailer.RegistrationCode(email, strings.TrimSpace(req.FirstName), code, int(models.OTPValidity.Minutes()))

	c.JSON(http.StatusOK, gin.H{
		"otp_sent": true,
		"email":    email,
		"message":  "We've emailed you a 6-digit code to confirm this address.",
	})
}

// ResendRegistration handles POST /auth/register/resend
func (h *OTPHandler) ResendRegistration(c *gin.Context) {
	var req struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))

	// The pending signup details live on the previous code's row, so a resend
	// carries them forward rather than asking for the form again.
	var pending models.EmailOTP
	if err := h.db.Where("email = ? AND purpose = ?", email, models.OTPPurposeRegister).
		Order("created_at DESC").First(&pending).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Start registration again — we have nothing pending for this address."})
		return
	}
	if wait, ok := h.cooldownRemaining(email, models.OTPPurposeRegister); !ok {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": fmt.Sprintf("A code was just sent. Try again in %d seconds.", wait),
		})
		return
	}

	code, _, err := h.issueOTP(email, models.OTPPurposeRegister, nil, pending.Payload, c.ClientIP())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not send the code"})
		return
	}
	firstName, _ := pending.Payload["first_name"].(string)
	mailer.RegistrationCode(email, firstName, code, int(models.OTPValidity.Minutes()))

	c.JSON(http.StatusOK, gin.H{"sent": true, "message": "A new code is on its way."})
}

// VerifyRegistration handles POST /auth/register/verify — creates the
// organization and its first admin, then signs them straight in.
func (h *OTPHandler) VerifyRegistration(c *gin.Context) {
	var req struct {
		Email string `json:"email" binding:"required,email"`
		Code  string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	otp, err := h.consumeOTP(req.Email, models.OTPPurposeRegister, req.Code)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	companyName, _ := otp.Payload["company_name"].(string)
	firstName, _ := otp.Payload["first_name"].(string)
	lastName, _ := otp.Payload["last_name"].(string)
	passwordHash, _ := otp.Payload["password_hash"].(string)
	if companyName == "" || passwordHash == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That registration is incomplete — please start again."})
		return
	}

	// Between the code being sent and redeemed, someone else may have taken the
	// address; re-check rather than failing on a database constraint.
	var existing int64
	h.db.Model(&models.User{}).Where("LOWER(email) = ?", otp.Email).Count(&existing)
	if existing > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "An account with this email already exists"})
		return
	}

	slug := uniqueOrgSlug(h.db, companyName)
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please enter a valid company name"})
		return
	}

	trialEnd := time.Now().AddDate(0, 0, 14)
	var user models.User
	err = h.db.Transaction(func(tx *gorm.DB) error {
		org := models.Organization{
			Name:        companyName,
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
			Email:        otp.Email,
			PasswordHash: passwordHash,
			FirstName:    firstName,
			LastName:     lastName,
			Role:         models.RoleOrgAdmin,
			Status:       models.StatusActive,
		}
		return tx.Create(&user).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create the organization"})
		return
	}

	h.db.Preload("Org").First(&user, "id = ?", user.ID)
	mailer.WelcomeOrg(user.Email, user.FirstName, companyName)

	resp, err := issueSession(h.db, &user, c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, resp)
}
