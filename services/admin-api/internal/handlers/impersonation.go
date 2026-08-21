package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"time"

	"github.com/aavishield/admin-api/internal/auth"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ImpersonationHandler is the superadmin-side half of "View as Org": mint a
// one-time code, hand it to the superadmin frontend to open in
// company-dashboard. AuthHandler.ImpersonateConsume (below) is the other
// half, run by company-dashboard's own backend.
type ImpersonationHandler struct {
	db *gorm.DB
}

func NewImpersonationHandler(db *gorm.DB) *ImpersonationHandler {
	return &ImpersonationHandler{db: db}
}

// impersonationCodeTTL is short on purpose — this code only has to survive
// the redirect from one tab to another, not a real session.
const impersonationCodeTTL = 2 * time.Minute

func generateImpersonationCode() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// Start handles POST /superadmin/organizations/:id/impersonate.
// SuperAdminFullOnly at the router — a support-level account can look at an
// org's data through the read endpoints already, but signing in AS one of
// its admins is a full-access-only action.
func (h *ImpersonationHandler) Start(c *gin.Context) {
	orgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad organization id"})
		return
	}

	var req struct {
		UserID string `json:"user_id"`
	}
	_ = c.ShouldBindJSON(&req)

	var target models.User
	q := h.db.Where("org_id = ? AND status = ?", orgID, models.StatusActive)
	if req.UserID != "" {
		q = q.Where("id = ?", req.UserID)
	} else {
		q = q.Where("role = ?", models.RoleOrgAdmin).Order("created_at ASC")
	}
	if err := q.First(&target).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active user found to impersonate in this organization"})
		return
	}

	code, err := generateImpersonationCode()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate impersonation code"})
		return
	}

	impersonatorID := currentUserID(c)
	if impersonatorID == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Could not identify the signed-in superadmin"})
		return
	}

	token := models.ImpersonationToken{
		Code:           code,
		TargetUserID:   target.ID,
		ImpersonatorID: *impersonatorID,
		ExpiresAt:      time.Now().Add(impersonationCodeTTL),
	}
	if err := h.db.Create(&token).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start impersonation"})
		return
	}

	writeAudit(h.db, c, &orgID, "impersonate_start", "organization", &orgID, map[string]any{
		"target_user_id": target.ID, "target_email": target.Email,
	})

	c.JSON(http.StatusOK, gin.H{
		"code":         code,
		"expires_in":   int(impersonationCodeTTL.Seconds()),
		"target_email": target.Email,
		"target_name":  target.FullName(),
	})
}

// ImpersonateConsume handles POST /api/v1/auth/impersonate/consume — called
// by company-dashboard's NextAuth backend, not by a browser directly, gated
// on the same X-Internal-Secret as SocialLogin. Exchanges a one-time code
// for a real session, minus a refresh token: the access token is the only
// thing issued, so the impersonated session dies on its own after 15
// minutes with nothing to revoke afterward.
func (h *AuthHandler) ImpersonateConsume(c *gin.Context) {
	if !validInternalSecret(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var token models.ImpersonationToken
	if err := h.db.Where("code = ?", req.Code).First(&token).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "This impersonation link is invalid or has already been used"})
		return
	}
	if token.ConsumedAt != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "This impersonation link has already been used"})
		return
	}
	if time.Now().After(token.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "This impersonation link has expired"})
		return
	}

	now := time.Now()
	h.db.Model(&token).Update("consumed_at", now)

	var user models.User
	if err := h.db.Preload("Org").First(&user, "id = ?", token.TargetUserID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "The impersonated account no longer exists"})
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

	writeAudit(h.db, c, user.OrgID, "impersonate_login", "organization", user.OrgID, map[string]any{
		"impersonator_id": token.ImpersonatorID, "target_user_id": user.ID,
	})

	resp := buildAuthResponse(&user, accessToken, "")
	c.JSON(http.StatusOK, resp)
}
