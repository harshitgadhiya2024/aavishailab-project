package handlers

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type OrgHandler struct {
	db *gorm.DB
}

func NewOrgHandler(db *gorm.DB) *OrgHandler {
	return &OrgHandler{db: db}
}

// List handles GET /superadmin/organizations
func (h *OrgHandler) List(c *gin.Context) {
	page, _  := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	search   := c.Query("search")
	status   := c.Query("status")
	plan     := c.Query("plan")

	if page < 1 { page = 1 }
	if limit > 100 { limit = 100 }

	q := h.db.Model(&models.Organization{})
	if search != "" {
		q = q.Where("LOWER(name) LIKE ? OR LOWER(domain) LIKE ?", "%"+search+"%", "%"+search+"%")
	}
	if status != "" { q = q.Where("status = ?", status) }
	if plan != "" { q = q.Where("plan = ?", plan) }

	var total int64
	q.Count(&total)

	var orgs []models.Organization
	q.Order("created_at DESC").Offset((page-1)*limit).Limit(limit).Find(&orgs)

	// Add user counts
	type OrgWithCounts struct {
		models.Organization
		UserCount     int `json:"user_count"`
		EmployeeCount int `json:"employee_count"`
		PolicyCount   int `json:"policy_count"`
	}
	result := make([]map[string]any, len(orgs))
	for i, org := range orgs {
		var uc, ec, pc int64
		h.db.Model(&models.User{}).Where("org_id = ?", org.ID).Count(&uc)
		h.db.Model(&models.Employee{}).Where("org_id = ?", org.ID).Count(&ec)
		h.db.Model(&models.Policy{}).Where("org_id = ?", org.ID).Count(&pc)
		result[i] = map[string]any{
			"id":             org.ID,
			"name":           org.Name,
			"slug":           org.Slug,
			"domain":         org.Domain,
			"status":         org.Status,
			"plan":           org.Plan,
			"max_users":      org.MaxUsers,
			"created_at":     org.CreatedAt,
			"is_active":      org.Status == models.OrgStatusActive,
			"user_count":     uc,
			"employee_count": ec,
			"policy_count":   pc,
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
		Name     string `json:"name" binding:"required"`
		Slug     string `json:"slug"`
		Domain   string `json:"domain"`
		Plan     string `json:"plan"`
		MaxUsers int    `json:"max_users"`
		AdminEmail    string `json:"admin_email" binding:"required,email"`
		AdminPassword string `json:"admin_password" binding:"required,min=8"`
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

	c.JSON(http.StatusOK, gin.H{
		"org":            org,
		"user_count":     uc,
		"employee_count": ec,
		"policy_count":   pc,
		"device_count":   dc,
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
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]any{}
	if req.Name != "" { updates["name"] = req.Name }
	if req.Domain != "" { updates["domain"] = req.Domain }
	if req.Status != "" { updates["status"] = req.Status }
	if req.Plan != "" { updates["plan"] = req.Plan }
	if req.MaxUsers > 0 { updates["max_users"] = req.MaxUsers }
	if req.LogoURL != "" { updates["logo_url"] = req.LogoURL }

	h.db.Model(&org).Updates(updates)
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
	c.JSON(http.StatusOK, gin.H{"message": "Organization deleted"})
}

// Stats handles GET /superadmin/stats
func (h *OrgHandler) Stats(c *gin.Context) {
	var totalOrgs, activeOrgs, totalUsers, totalEmployees, totalEvents int64
	h.db.Model(&models.Organization{}).Count(&totalOrgs)
	h.db.Model(&models.Organization{}).Where("status = 'active'").Count(&activeOrgs)
	h.db.Model(&models.User{}).Where("org_id IS NOT NULL").Count(&totalUsers)
	h.db.Model(&models.Employee{}).Count(&totalEmployees)
	h.db.Model(&models.ActivityEvent{}).Count(&totalEvents)

	type PlanCount struct {
		Plan  string `json:"plan"`
		Count int    `json:"count"`
	}
	var byPlan []PlanCount
	h.db.Raw("SELECT plan, COUNT(*) as count FROM organizations GROUP BY plan").Scan(&byPlan)

	c.JSON(http.StatusOK, gin.H{
		"total_organizations": totalOrgs,
		"active_organizations": activeOrgs,
		"total_users":         totalUsers,
		"total_employees":     totalEmployees,
		"total_events":        totalEvents,
		"by_plan":             byPlan,
	})
}

var nonSlugChars = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(value string) string {
	s := strings.ToLower(strings.TrimSpace(value))
	s = nonSlugChars.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	return s
}
