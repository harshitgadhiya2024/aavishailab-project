package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// OrgUserHandler manages the people who can sign in to the company dashboard —
// distinct from Employee, which is a person whose devices are monitored. A
// dashboard user has a role (what they may do) and optionally a set of teams
// (whose people they may see).
type OrgUserHandler struct {
	db *gorm.DB
}

func NewOrgUserHandler(db *gorm.DB) *OrgUserHandler { return &OrgUserHandler{db: db} }

// orgUserResponse is a User plus the derived access facts the UI needs.
type orgUserResponse struct {
	models.User
	Permissions []string    `json:"permissions"`
	TeamIDs     []uuid.UUID `json:"team_ids"`
	TeamNames   []string    `json:"team_names"`
}

func (h *OrgUserHandler) withAccess(users []models.User) []orgUserResponse {
	out := make([]orgUserResponse, 0, len(users))
	if len(users) == 0 {
		return out
	}

	ids := make([]uuid.UUID, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.ID)
	}

	var links []models.UserTeam
	h.db.Where("user_id IN ?", ids).Find(&links)

	teamIDs := make([]uuid.UUID, 0, len(links))
	for _, l := range links {
		teamIDs = append(teamIDs, l.TeamID)
	}
	nameOf := map[uuid.UUID]string{}
	if len(teamIDs) > 0 {
		var teams []models.Team
		h.db.Where("id IN ?", teamIDs).Find(&teams)
		for _, t := range teams {
			nameOf[t.ID] = t.Name
		}
	}

	byUser := map[uuid.UUID][]models.UserTeam{}
	for _, l := range links {
		byUser[l.UserID] = append(byUser[l.UserID], l)
	}

	for _, u := range users {
		resp := orgUserResponse{
			User:        u,
			Permissions: models.PermissionsForRole(u.Role),
			TeamIDs:     []uuid.UUID{},
			TeamNames:   []string{},
		}
		for _, l := range byUser[u.ID] {
			resp.TeamIDs = append(resp.TeamIDs, l.TeamID)
			if name, ok := nameOf[l.TeamID]; ok {
				resp.TeamNames = append(resp.TeamNames, name)
			}
		}
		out = append(out, resp)
	}
	return out
}

// List handles GET /users
func (h *OrgUserHandler) List(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var users []models.User
	q := h.db.Where("org_id = ?", orgID)
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		like := "%" + strings.ToLower(search) + "%"
		q = q.Where("LOWER(first_name || ' ' || last_name) LIKE ? OR LOWER(email) LIKE ?", like, like)
	}
	if role := c.Query("role"); role != "" {
		q = q.Where("role = ?", role)
	}
	q.Order("created_at ASC").Find(&users)

	c.JSON(http.StatusOK, gin.H{
		"data":  h.withAccess(users),
		"total": len(users),
		"roles": roleCatalog(),
	})
}

// roleCatalog describes the assignable roles so the UI can explain them
// without hardcoding a second copy of the permission model.
func roleCatalog() []gin.H {
	descriptions := map[models.UserRole]string{
		models.RoleOrgAdmin: "Full control of the organization, including who else has access",
		models.RoleManager:  "Manages their assigned teams: their people, their access requests",
		models.RoleAnalyst:  "Investigates activity and tunes enforcement across the whole org",
		models.RoleReadOnly: "Can view and export everything, change nothing",
	}
	out := make([]gin.H, 0, len(models.AssignableRoles))
	for _, r := range models.AssignableRoles {
		out = append(out, gin.H{
			"role":        string(r),
			"description": descriptions[r],
			"permissions": models.PermissionsForRole(r),
			// Only a manager's view is narrowed by team assignment; for other
			// roles the team picker would be a control that does nothing.
			"team_scoped": r == models.RoleManager,
		})
	}
	return out
}

type orgUserRequest struct {
	Email      string      `json:"email"`
	FirstName  string      `json:"first_name"`
	LastName   string      `json:"last_name"`
	Role       string      `json:"role"`
	JobTitle   string      `json:"job_title"`
	Password   string      `json:"password"`
	Status     string      `json:"status"`
	TeamIDs    []uuid.UUID `json:"team_ids"`
}

func generatePassword() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "Delsecure#" + uuid.NewString()[:8]
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// Create handles POST /users — add someone to the dashboard.
func (h *OrgUserHandler) Create(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "No organization context"})
		return
	}

	var req orgUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" || !strings.Contains(req.Email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A valid email is required"})
		return
	}

	role := models.UserRole(strings.TrimSpace(req.Role))
	if !models.IsAssignableRole(role) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Choose one of: org_admin, manager, analyst, read_only"})
		return
	}

	var existing int64
	h.db.Model(&models.User{}).Where("LOWER(email) = ?", req.Email).Count(&existing)
	if existing > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "A user with that email already exists"})
		return
	}

	// A generated password is returned exactly once, in this response — it is
	// stored only as a hash, so it cannot be shown again later.
	password := req.Password
	generated := false
	if strings.TrimSpace(password) == "" {
		password = generatePassword()
		generated = true
	}
	if len(password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Password must be at least 8 characters"})
		return
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to secure the password"})
		return
	}

	user := models.User{
		OrgID:        &orgID,
		Email:        req.Email,
		PasswordHash: string(hashed),
		FirstName:    strings.TrimSpace(req.FirstName),
		LastName:     strings.TrimSpace(req.LastName),
		Role:         role,
		JobTitle:     strings.TrimSpace(req.JobTitle),
		Status:       models.StatusActive,
	}
	if err := h.db.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create the user"})
		return
	}

	h.replaceTeams(orgID, user.ID, role, req.TeamIDs)

	// Tell them they have access. The password only travels here and in the
	// response — it exists nowhere else once this request ends.
	var org models.Organization
	orgName := "your organization"
	if err := h.db.First(&org, "id = ?", orgID).Error; err == nil {
		orgName = org.Name
	}
	invitedBy := "An administrator"
	if actorRaw, ok := c.Get(middleware.ContextKeyUserID); ok {
		if actorID, isUUID := actorRaw.(uuid.UUID); isUUID {
			var actor models.User
			if err := h.db.First(&actor, "id = ?", actorID).Error; err == nil {
				if name := strings.TrimSpace(actor.FullName()); name != "" {
					invitedBy = name
				}
			}
		}
	}
	roleLabel := map[models.UserRole]string{
		models.RoleOrgAdmin: "Administrator",
		models.RoleManager:  "Team manager",
		models.RoleAnalyst:  "Security analyst",
		models.RoleReadOnly: "Read only",
	}[role]
	mailer.InviteUser(user.Email, user.FirstName, orgName, roleLabel, password, invitedBy)

	resp := gin.H{"user": h.withAccess([]models.User{user})[0]}
	if generated {
		resp["temporary_password"] = password
		resp["note"] = "Share this password with the user — it cannot be shown again."
	}
	c.JSON(http.StatusCreated, resp)
}

// replaceTeams rewrites a user's team scoping. Only a manager is team-scoped;
// for every other role the assignments are cleared, so a demotion can't leave
// stale rows that would silently narrow an admin's view later.
func (h *OrgUserHandler) replaceTeams(orgID, userID uuid.UUID, role models.UserRole, teamIDs []uuid.UUID) {
	h.db.Where("user_id = ?", userID).Delete(&models.UserTeam{})
	if role != models.RoleManager || len(teamIDs) == 0 {
		return
	}
	for _, teamID := range teamIDs {
		var team models.Team
		if err := h.db.Where("id = ? AND org_id = ?", teamID, orgID).First(&team).Error; err != nil {
			continue // ignore teams from another org or ones that no longer exist
		}
		h.db.Create(&models.UserTeam{UserID: userID, TeamID: team.ID, OrgID: orgID})
	}
}

// Update handles PUT /users/:id
func (h *OrgUserHandler) Update(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))
	actorID, _ := c.Get(middleware.ContextKeyUserID)

	var user models.User
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	var req orgUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]any{}
	if req.FirstName != "" {
		updates["first_name"] = strings.TrimSpace(req.FirstName)
	}
	if req.LastName != "" {
		updates["last_name"] = strings.TrimSpace(req.LastName)
	}
	if req.JobTitle != "" {
		updates["job_title"] = strings.TrimSpace(req.JobTitle)
	}

	if req.Role != "" {
		role := models.UserRole(strings.TrimSpace(req.Role))
		if !models.IsAssignableRole(role) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Choose one of: org_admin, manager, analyst, read_only"})
			return
		}
		// Locking yourself out is not a recoverable mistake from inside the UI.
		if uid, ok := actorID.(uuid.UUID); ok && uid == user.ID && role != models.RoleOrgAdmin {
			c.JSON(http.StatusBadRequest, gin.H{"error": "You cannot change your own role — ask another admin"})
			return
		}
		if user.Role == models.RoleOrgAdmin && role != models.RoleOrgAdmin && h.lastAdmin(orgID, user.ID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "This is the last admin — promote someone else first"})
			return
		}
		updates["role"] = role
	}

	if req.Status != "" {
		status := models.UserStatus(strings.TrimSpace(req.Status))
		if status != models.StatusActive && status != models.StatusInactive && status != models.StatusSuspended {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Status must be active, inactive or suspended"})
			return
		}
		if uid, ok := actorID.(uuid.UUID); ok && uid == user.ID && status != models.StatusActive {
			c.JSON(http.StatusBadRequest, gin.H{"error": "You cannot deactivate your own account"})
			return
		}
		updates["status"] = status
	}

	if strings.TrimSpace(req.Password) != "" {
		if len(req.Password) < 8 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Password must be at least 8 characters"})
			return
		}
		hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to secure the password"})
			return
		}
		updates["password_hash"] = string(hashed)
	}

	if len(updates) > 0 {
		h.db.Model(&user).Updates(updates)
	}

	role := user.Role
	if r, ok := updates["role"].(models.UserRole); ok {
		role = r
	}
	if req.TeamIDs != nil || role != models.RoleManager {
		h.replaceTeams(orgID, user.ID, role, req.TeamIDs)
	}

	h.db.Where("id = ?", user.ID).First(&user)
	c.JSON(http.StatusOK, h.withAccess([]models.User{user})[0])
}

// lastAdmin reports whether this user is the org's only remaining admin.
func (h *OrgUserHandler) lastAdmin(orgID, excluding uuid.UUID) bool {
	var count int64
	h.db.Model(&models.User{}).
		Where("org_id = ? AND role = ? AND status = ? AND id <> ?",
			orgID, models.RoleOrgAdmin, models.StatusActive, excluding).
		Count(&count)
	return count == 0
}

// Delete handles DELETE /users/:id
func (h *OrgUserHandler) Delete(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))
	actorID, _ := c.Get(middleware.ContextKeyUserID)

	var user models.User
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if uid, ok := actorID.(uuid.UUID); ok && uid == user.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You cannot remove your own account"})
		return
	}
	if user.Role == models.RoleOrgAdmin && h.lastAdmin(orgID, user.ID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This is the last admin — promote someone else first"})
		return
	}

	h.db.Where("user_id = ?", user.ID).Delete(&models.UserTeam{})
	// Existing sessions must die with the account, or a removed admin keeps
	// working until their refresh token expires.
	h.db.Model(&models.RefreshToken{}).Where("user_id = ?", user.ID).Update("revoked", true)
	h.db.Delete(&user)

	c.JSON(http.StatusOK, gin.H{"message": "User removed"})
}
