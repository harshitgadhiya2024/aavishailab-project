package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// SuperAdminTeamHandler manages who has superadmin access. Before this, the
// role was a single boolean with no page anywhere that showed who held it or
// any way to add someone without a direct database write.
type SuperAdminTeamHandler struct {
	db *gorm.DB
}

func NewSuperAdminTeamHandler(db *gorm.DB) *SuperAdminTeamHandler {
	return &SuperAdminTeamHandler{db: db}
}

func validSuperAdminLevel(level string) bool {
	return models.SuperAdminLevel(level) == models.SuperAdminLevelFull ||
		models.SuperAdminLevel(level) == models.SuperAdminLevelSupport
}

// List handles GET /superadmin/team
func (h *SuperAdminTeamHandler) List(c *gin.Context) {
	var users []models.User
	h.db.Where("org_id IS NULL AND role = ?", models.RoleSuperAdmin).
		Order("created_at ASC").Find(&users)

	out := make([]*UserDTO, 0, len(users))
	for i := range users {
		out = append(out, toUserDTO(&users[i]))
	}
	c.JSON(http.StatusOK, gin.H{"team": out, "total": len(out)})
}

type superAdminInviteRequest struct {
	Email     string `json:"email" binding:"required,email"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Level     string `json:"level"`
}

func generateSuperAdminPassword() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "Delsecure#" + uuid.NewString()[:8]
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// Create handles POST /superadmin/team — invites a new superadmin. Gated on
// SuperAdminFullOnly at the router: only a full-access superadmin can grant
// anyone else access, support-level or otherwise.
func (h *SuperAdminTeamHandler) Create(c *gin.Context) {
	var req superAdminInviteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	level := strings.TrimSpace(req.Level)
	if level == "" {
		level = string(models.SuperAdminLevelSupport)
	}
	if !validSuperAdminLevel(level) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "level must be full or support"})
		return
	}

	var existing int64
	h.db.Model(&models.User{}).Where("LOWER(email) = ?", req.Email).Count(&existing)
	if existing > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "A user with that email already exists"})
		return
	}

	password := generateSuperAdminPassword()
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to secure the password"})
		return
	}

	user := models.User{
		OrgID:           nil,
		Email:           req.Email,
		PasswordHash:    string(hashed),
		FirstName:       strings.TrimSpace(req.FirstName),
		LastName:        strings.TrimSpace(req.LastName),
		Role:            models.RoleSuperAdmin,
		SuperAdminLevel: models.SuperAdminLevel(level),
		Status:          models.StatusActive,
	}
	if err := h.db.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create the user"})
		return
	}

	invitedBy := "An administrator"
	if actor := currentUserID(c); actor != nil {
		var a models.User
		if err := h.db.First(&a, "id = ?", *actor).Error; err == nil {
			if name := strings.TrimSpace(a.FullName()); name != "" {
				invitedBy = name
			}
		}
	}
	roleLabel := "Superadmin (support — read only)"
	if level == string(models.SuperAdminLevelFull) {
		roleLabel = "Superadmin (full access)"
	}
	mailer.InviteUser(user.Email, user.FirstName, "Aavishield Platform", roleLabel, password, invitedBy)

	writeAudit(h.db, c, nil, "invite", "superadmin_team", &user.ID, map[string]any{
		"email": user.Email, "level": level,
	})

	c.JSON(http.StatusCreated, gin.H{
		"user":               toUserDTO(&user),
		"temporary_password": password,
		"note":               "Share this password with them — it cannot be shown again.",
	})
}

type superAdminUpdateRequest struct {
	Level  string `json:"level"`
	Status string `json:"status"`
}

// countFullAdmins returns how many active, full-level superadmins exist —
// used to stop the last one from being demoted or deactivated, which would
// otherwise lock the whole platform out of its own destructive actions.
func (h *SuperAdminTeamHandler) countFullAdmins(excluding uuid.UUID) int64 {
	var n int64
	h.db.Model(&models.User{}).
		Where("org_id IS NULL AND role = ? AND superadmin_level = ? AND status = ? AND id <> ?",
			models.RoleSuperAdmin, models.SuperAdminLevelFull, models.StatusActive, excluding).
		Count(&n)
	return n
}

// Update handles PATCH /superadmin/team/:id — change level and/or status.
func (h *SuperAdminTeamHandler) Update(c *gin.Context) {
	id := c.Param("id")

	var user models.User
	if err := h.db.Where("id = ? AND org_id IS NULL AND role = ?", id, models.RoleSuperAdmin).
		First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Superadmin not found"})
		return
	}

	var req superAdminUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]any{}
	demotingOrDeactivating := false

	if req.Level != "" {
		if !validSuperAdminLevel(req.Level) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "level must be full or support"})
			return
		}
		if user.SuperAdminLevel == models.SuperAdminLevelFull && models.SuperAdminLevel(req.Level) != models.SuperAdminLevelFull {
			demotingOrDeactivating = true
		}
		updates["superadmin_level"] = req.Level
	}
	if req.Status != "" {
		status := models.UserStatus(req.Status)
		if status != models.StatusActive && status != models.StatusSuspended && status != models.StatusInactive {
			c.JSON(http.StatusBadRequest, gin.H{"error": "status must be active, suspended, or inactive"})
			return
		}
		if user.SuperAdminLevel == models.SuperAdminLevelFull && status != models.StatusActive {
			demotingOrDeactivating = true
		}
		updates["status"] = req.Status
	}

	if demotingOrDeactivating && h.countFullAdmins(user.ID) == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Can't remove the last full-access superadmin — promote someone else first"})
		return
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Nothing to update"})
		return
	}

	h.db.Model(&user).Updates(updates)
	writeAudit(h.db, c, nil, "update", "superadmin_team", &user.ID, updates)
	c.JSON(http.StatusOK, toUserDTO(&user))
}

// Delete handles DELETE /superadmin/team/:id — deactivates rather than
// hard-deleting, so the audit trail keeps meaning ("who had access, and
// when it was revoked") instead of the row just disappearing.
func (h *SuperAdminTeamHandler) Delete(c *gin.Context) {
	id := c.Param("id")

	var user models.User
	if err := h.db.Where("id = ? AND org_id IS NULL AND role = ?", id, models.RoleSuperAdmin).
		First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Superadmin not found"})
		return
	}

	if actor := currentUserID(c); actor != nil && *actor == user.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You can't remove your own access"})
		return
	}
	if user.SuperAdminLevel == models.SuperAdminLevelFull && h.countFullAdmins(user.ID) == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Can't remove the last full-access superadmin"})
		return
	}

	h.db.Model(&user).Update("status", models.StatusInactive)
	writeAudit(h.db, c, nil, "deactivate", "superadmin_team", &user.ID, map[string]any{"email": user.Email})
	c.JSON(http.StatusOK, gin.H{"message": "Superadmin access removed"})
}
