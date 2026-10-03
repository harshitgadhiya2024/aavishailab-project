package handlers

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/models"
)

type OrgHandler struct {
	db *gorm.DB
}

func NewOrgHandler(db *gorm.DB) *OrgHandler {
	return &OrgHandler{db: db}
}

// List handles GET /superadmin/organizations
func (h *OrgHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	search := c.Query("search")
	status := c.Query("status")
	plan := c.Query("plan")

	if page < 1 {
		page = 1
	}
	if limit > 100 {
		limit = 100
	}

	q := h.db.Model(&models.Organization{})
	if search = strings.ToLower(strings.TrimSpace(search)); search != "" {
		like := "%" + search + "%"
		q = q.Where("LOWER(name) LIKE ? OR LOWER(domain) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(contact_email) LIKE ?", like, like, like, like)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if plan != "" {
		q = q.Where("plan = ?", plan)
	}

	var total int64
	q.Count(&total)

	order := "created_at DESC"
	switch c.Query("sort") {
	case "name":
		order = "LOWER(name) ASC"
	case "oldest":
		order = "created_at ASC"
	case "trial_ending":
		order = "trial_ends_at ASC NULLS LAST"
	}
	var orgs []models.Organization
	q.Order(order).Offset((page - 1) * limit).Limit(limit).Find(&orgs)

	// Per-org counts for the page in one grouped query per table, not three
	// queries per row.
	ids := make([]uuid.UUID, len(orgs))
	for i, o := range orgs {
		ids[i] = o.ID
	}
	type cnt struct {
		OrgID uuid.UUID
		N     int64
	}
	countBy := func(model any, where string, args ...any) map[uuid.UUID]int64 {
		out := map[uuid.UUID]int64{}
		if len(ids) == 0 {
			return out
		}
		var rows []cnt
		tx := h.db.Model(model).Select("org_id, COUNT(*) AS n").Where("org_id IN ?", ids)
		if where != "" {
			tx = tx.Where(where, args...)
		}
		tx.Group("org_id").Scan(&rows)
		for _, r := range rows {
			out[r.OrgID] = r.N
		}
		return out
	}
	users := countBy(&models.User{}, "")
	employees := countBy(&models.Employee{}, "")
	policies := countBy(&models.Policy{}, "")
	devices := countBy(&models.Device{}, "status <> ?", "revoked")
	online := countBy(&models.Device{}, "status = ?", "online")
	lastSeen := map[uuid.UUID]*time.Time{}
	if len(ids) > 0 {
		var rows []struct {
			OrgID    uuid.UUID
			LastSeen *time.Time
		}
		h.db.Model(&models.Device{}).Select("org_id, MAX(last_seen_at) AS last_seen").
			Where("org_id IN ?", ids).Group("org_id").Scan(&rows)
		for _, r := range rows {
			lastSeen[r.OrgID] = r.LastSeen
		}
	}

	result := make([]map[string]any, len(orgs))
	for i, org := range orgs {
		result[i] = map[string]any{
			"id":             org.ID,
			"name":           org.Name,
			"slug":           org.Slug,
			"domain":         org.Domain,
			"contact_email":  org.ContactEmail,
			"status":         org.Status,
			"plan":           org.Plan,
			"max_users":      org.MaxUsers,
			"trial_ends_at":  org.TrialEndsAt,
			"created_at":     org.CreatedAt,
			"is_active":      org.Status == models.OrgStatusActive,
			"user_count":     users[org.ID],
			"employee_count": employees[org.ID],
			"policy_count":   policies[org.ID],
			"device_count":   devices[org.ID],
			"online_count":   online[org.ID],
			"last_seen_at":   lastSeen[org.ID],
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"organizations": result,
		"total":         total,
		"page":          page,
		"limit":         limit,
		"pages":         (total + int64(limit) - 1) / int64(limit),
	})
}

// Create handles POST /superadmin/organizations
func (h *OrgHandler) Create(c *gin.Context) {
	var req struct {
		Name           string `json:"name" binding:"required"`
		Slug           string `json:"slug"`
		Domain         string `json:"domain"`
		Plan           string `json:"plan"`
		MaxUsers       int    `json:"max_users"`
		AdminEmail     string `json:"admin_email" binding:"required,email"`
		AdminPassword  string `json:"admin_password" binding:"required,min=8"`
		AdminFirstName string `json:"admin_first_name"`
		AdminLastName  string `json:"admin_last_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	slug := strings.TrimSpace(req.Slug)
	if slug == "" {
		slug = slugify(req.Name)
	}
	if slug == "" && req.Domain != "" {
		slug = slugify(strings.Split(req.Domain, ".")[0])
	}
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Could not generate organization slug"})
		return
	}

	// Check slug uniqueness
	var count int64
	h.db.Model(&models.Organization{}).Where("slug = ?", slug).Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Organization slug already taken"})
		return
	}

	plan := models.PlanTrial
	if req.Plan != "" {
		plan = models.PlanType(req.Plan)
	}
	maxUsers := 50
	if req.MaxUsers > 0 {
		maxUsers = req.MaxUsers
	}

	org := models.Organization{
		Name:     req.Name,
		Slug:     slug,
		Domain:   req.Domain,
		Status:   models.OrgStatusActive,
		Plan:     plan,
		MaxUsers: maxUsers,
	}

	if err := h.db.Create(&org).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create organization"})
		return
	}

	// Create admin user
	hashed, _ := bcrypt.GenerateFromPassword([]byte(req.AdminPassword), bcrypt.DefaultCost)
	user := models.User{
		OrgID:        &org.ID,
		Email:        req.AdminEmail,
		PasswordHash: string(hashed),
		FirstName:    req.AdminFirstName,
		LastName:     req.AdminLastName,
		Role:         models.RoleOrgAdmin,
		Status:       models.StatusActive,
	}
	h.db.Create(&user)

	writeAudit(h.db, c, &org.ID, "create", "organization", &org.ID, map[string]any{
		"name": org.Name, "plan": string(org.Plan), "admin_email": user.Email,
	})

	c.JSON(http.StatusCreated, gin.H{"org": org, "admin": toUserDTO(&user)})
}

// Get handles GET /superadmin/organizations/:id
func (h *OrgHandler) Get(c *gin.Context) {
	orgID := c.Param("id")

	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	var uc, ec, pc, dc int64
	h.db.Model(&models.User{}).Where("org_id = ?", org.ID).Count(&uc)
	h.db.Model(&models.Employee{}).Where("org_id = ?", org.ID).Count(&ec)
	h.db.Model(&models.Policy{}).Where("org_id = ?", org.ID).Count(&pc)
	h.db.Model(&models.Device{}).Where("org_id = ?", org.ID).Count(&dc)

	// Detail-page context beyond the counts every list row already carries —
	// enough to answer "what's going on with this customer" without a direct
	// database query, which was previously the only way to find out.
	var users []models.User
	h.db.Where("org_id = ?", org.ID).Order("created_at DESC").Limit(25).Find(&users)
	userDTOs := make([]*UserDTO, 0, len(users))
	for i := range users {
		userDTOs = append(userDTOs, toUserDTO(&users[i]))
	}

	var devices []models.Device
	h.db.Where("org_id = ?", org.ID).Order("last_seen_at DESC NULLS LAST").Limit(25).Find(&devices)

	// Only what Aavishield itself holds: an organization that keeps its
	// employee data on its own infrastructure is not readable from here, and
	// the console says so rather than reaching into the company's database.
	recentActivity := []models.ActivityEvent{}
	ownStorage := dataplane.IsTenant(c.Request.Context(), org.ID)
	if !ownStorage {
		recentActivity, _ = dataplane.Primary().FindEvents(c.Request.Context(), dataplane.EventQuery{OrgID: org.ID, Limit: 20})
	}

	c.JSON(http.StatusOK, gin.H{
		"org":             org,
		"user_count":      uc,
		"employee_count":  ec,
		"policy_count":    pc,
		"device_count":    dc,
		"users":           userDTOs,
		"devices":         devices,
		"recent_activity": recentActivity,
		"data_residency":  ownStorage,
	})
}

// Update handles PUT /superadmin/organizations/:id
func (h *OrgHandler) Update(c *gin.Context) {
	orgID := c.Param("id")

	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	var req struct {
		Name     string `json:"name"`
		Domain   string `json:"domain"`
		Status   string `json:"status"`
		Plan     string `json:"plan"`
		MaxUsers int    `json:"max_users"`
		LogoURL  string `json:"logo_url"`
		// TrialEndsAt (YYYY-MM-DD) extends or shortens a trial.
		TrialEndsAt string `json:"trial_ends_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	switch models.OrgStatus(req.Status) {
	case "", models.OrgStatusActive, models.OrgStatusInactive, models.OrgStatusSuspended, models.OrgStatusTrial:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown status"})
		return
	}
	switch models.PlanType(req.Plan) {
	case "", models.PlanTrial, models.PlanStarter, models.PlanProfessional, models.PlanEnterprise:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown plan"})
		return
	}

	updates := map[string]any{}
	if req.TrialEndsAt != "" {
		// End of that day in the organization's own time zone.
		loc, err := time.LoadLocation(org.Timezone)
		if err != nil || org.Timezone == "" {
			loc = time.UTC
		}
		t, err := time.ParseInLocation("2006-01-02", req.TrialEndsAt, loc)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Trial end date must be YYYY-MM-DD"})
			return
		}
		updates["trial_ends_at"] = t.Add(24*time.Hour - time.Second)
	}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Domain != "" {
		updates["domain"] = req.Domain
	}
	if req.Status != "" {
		updates["status"] = req.Status
	}
	if req.Plan != "" {
		updates["plan"] = req.Plan
	}
	if req.MaxUsers > 0 {
		updates["max_users"] = req.MaxUsers
	}
	if req.LogoURL != "" {
		updates["logo_url"] = req.LogoURL
	}

	if err := h.db.Model(&org).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update organization"})
		return
	}
	orgUUID := org.ID
	writeAudit(h.db, c, &orgUUID, "update", "organization", &orgUUID, updates)
	h.db.First(&org, "id = ?", org.ID)
	c.JSON(http.StatusOK, org)
}

// Delete handles DELETE /superadmin/organizations/:id
func (h *OrgHandler) Delete(c *gin.Context) {
	orgID := c.Param("id")
	orgUUID, _ := uuid.Parse(orgID)

	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgUUID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	// Soft delete
	h.db.Delete(&org)
	writeAudit(h.db, c, &orgUUID, "delete", "organization", &orgUUID, map[string]any{"name": org.Name})
	c.JSON(http.StatusOK, gin.H{"message": "Organization deleted"})
}

// Stats handles GET /superadmin/stats
func (h *OrgHandler) Stats(c *gin.Context) {
	var totalOrgs, activeOrgs, totalUsers, totalEmployees, totalEvents int64
	h.db.Model(&models.Organization{}).Count(&totalOrgs)
	h.db.Model(&models.Organization{}).Where("status = 'active'").Count(&activeOrgs)
	h.db.Model(&models.User{}).Where("org_id IS NOT NULL").Count(&totalUsers)
	h.db.Model(&models.Employee{}).Count(&totalEmployees)
	// Events Aavishield holds; companies on their own storage aren't counted.
	totalEvents, _ = dataplane.Primary().CountEvents(c.Request.Context(), dataplane.EventQuery{
		NotActions: dataplane.Strings(models.EventActionAllowed),
	})

	type PlanCount struct {
		Plan  string `json:"plan"`
		Count int    `json:"count"`
	}
	var byPlan []PlanCount
	h.db.Raw("SELECT plan, COUNT(*) as count FROM organizations GROUP BY plan").Scan(&byPlan)

	c.JSON(http.StatusOK, gin.H{
		"total_organizations":  totalOrgs,
		"active_organizations": activeOrgs,
		"total_users":          totalUsers,
		"total_employees":      totalEmployees,
		"total_events":         totalEvents,
		"by_plan":              byPlan,
	})
}

var nonSlugChars = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(value string) string {
	s := strings.ToLower(strings.TrimSpace(value))
	s = nonSlugChars.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	return s
}
