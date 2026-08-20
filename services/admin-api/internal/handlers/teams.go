package handlers

import (
	"net/http"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type TeamHandler struct {
	db *gorm.DB
}

func NewTeamHandler(db *gorm.DB) *TeamHandler {
	return &TeamHandler{db: db}
}

type TeamRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Color       string `json:"color"`
}

// List handles GET /teams
func (h *TeamHandler) List(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var teams []models.Team
	h.db.Where("org_id = ?", orgID).
		Order("name ASC").
		Find(&teams)

	// Attach member counts
	for i := range teams {
		var count int64
		h.db.Model(&models.Employee{}).Where("team_id = ?", teams[i].ID).Count(&count)
		teams[i].MemberCount = int(count)
	}

	c.JSON(http.StatusOK, gin.H{"data": teams, "total": len(teams)})
}

// Create handles POST /teams
func (h *TeamHandler) Create(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	userID, _ := c.Get("user_id")
	uid, _ := userID.(uuid.UUID)

	var req TeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orgUUID, _ := uuid.Parse(orgID)

	// Check name uniqueness within org
	var count int64
	h.db.Model(&models.Team{}).Where("org_id = ? AND name = ?", orgID, req.Name).Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Team name already exists"})
		return
	}

	color := req.Color
	if color == "" {
		color = "#0048A0"
	}

	team := models.Team{
		OrgID:       orgUUID,
		Name:        req.Name,
		Description: req.Description,
		Color:       color,
		CreatedBy:   &uid,
	}

	if err := h.db.Create(&team).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create team"})
		return
	}

	c.JSON(http.StatusCreated, team)
}

// Get handles GET /teams/:id
func (h *TeamHandler) Get(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	teamID := c.Param("id")

	var team models.Team
	if err := h.db.Where("id = ? AND org_id = ?", teamID, orgID).
		Preload("Employees").
		First(&team).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	var count int64
	h.db.Model(&models.Employee{}).Where("team_id = ?", team.ID).Count(&count)
	team.MemberCount = int(count)

	c.JSON(http.StatusOK, team)
}

// Update handles PUT /teams/:id
func (h *TeamHandler) Update(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	teamID := c.Param("id")

	var team models.Team
	if err := h.db.Where("id = ? AND org_id = ?", teamID, orgID).First(&team).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	var req TeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check name uniqueness (exclude self)
	var count int64
	h.db.Model(&models.Team{}).
		Where("org_id = ? AND name = ? AND id != ?", orgID, req.Name, teamID).
		Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Team name already exists"})
		return
	}

	updates := map[string]any{
		"name":        req.Name,
		"description": req.Description,
	}
	if req.Color != "" {
		updates["color"] = req.Color
	}

	h.db.Model(&team).Updates(updates)
	c.JSON(http.StatusOK, team)
}

// Delete handles DELETE /teams/:id
func (h *TeamHandler) Delete(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	teamID := c.Param("id")

	var team models.Team
	if err := h.db.Where("id = ? AND org_id = ?", teamID, orgID).First(&team).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	// Unassign employees from team
	h.db.Model(&models.Employee{}).Where("team_id = ?", teamID).Update("team_id", nil)

	if err := h.db.Delete(&team).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete team"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Team deleted successfully"})
}

// AssignEmployees handles POST /teams/:id/employees
func (h *TeamHandler) AssignEmployees(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	teamID := c.Param("id")

	var req struct {
		EmployeeIDs []uuid.UUID `json:"employee_ids" binding:"required"`
		Replace     bool        `json:"replace"` // true = replace all, false = add
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify team belongs to org
	var team models.Team
	if err := h.db.Where("id = ? AND org_id = ?", teamID, orgID).First(&team).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	teamUUID, _ := uuid.Parse(teamID)

	if req.Replace {
		// Remove all current members first
		h.db.Model(&models.Employee{}).Where("team_id = ? AND org_id = ?", teamID, orgID).
			Update("team_id", nil)
	}

	// Assign employees
	result := h.db.Model(&models.Employee{}).
		Where("id IN ? AND org_id = ?", req.EmployeeIDs, orgID).
		Update("team_id", teamUUID)

	c.JSON(http.StatusOK, gin.H{
		"assigned": result.RowsAffected,
		"message":  "Employees assigned to team",
	})
}

// RemoveEmployee handles DELETE /teams/:id/employees/:emp_id
func (h *TeamHandler) RemoveEmployee(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	empID := c.Param("emp_id")

	h.db.Model(&models.Employee{}).
		Where("id = ? AND org_id = ?", empID, orgID).
		Update("team_id", nil)

	c.JSON(http.StatusOK, gin.H{"message": "Employee removed from team"})
}

// GetMembers handles GET /teams/:id/members
func (h *TeamHandler) GetMembers(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	teamID := c.Param("id")

	var employees []models.Employee
	h.db.Where("team_id = ? AND org_id = ?", teamID, orgID).
		Order("first_name ASC").
		Find(&employees)

	c.JSON(http.StatusOK, gin.H{"data": employees, "total": len(employees)})
}
