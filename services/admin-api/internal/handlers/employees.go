package handlers

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type EmployeeHandler struct {
	db *gorm.DB
}

func NewEmployeeHandler(db *gorm.DB) *EmployeeHandler {
	return &EmployeeHandler{db: db}
}

type EmployeeRequest struct {
	FirstName  string     `json:"first_name" binding:"required"`
	LastName   string     `json:"last_name" binding:"required"`
	Email      string     `json:"email" binding:"required,email"`
	Phone      string     `json:"phone"`
	Department string     `json:"department"`
	JobTitle   string     `json:"job_title"`
	EmployeeID string     `json:"employee_id"`
	TeamID     *uuid.UUID `json:"team_id"`
	Status     string     `json:"status"`
	AvatarURL  string     `json:"avatar_url"`
}

// List handles GET /employees
func (h *EmployeeHandler) List(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	page, _  := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	search   := c.Query("search")
	teamID   := c.Query("team_id")
	dept     := c.Query("department")
	status   := c.Query("status")

	if page < 1 { page = 1 }
	if limit < 1 || limit > 100 { limit = 20 }
	offset := (page - 1) * limit

	q := h.db.Where("org_id = ?", orgID)
	// A team-scoped manager only ever sees their own teams' employees.
	q = applyTeamScope(h.db, c, q)

	if search != "" {
		like := "%" + strings.ToLower(search) + "%"
		q = q.Where("LOWER(first_name || ' ' || last_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(department) LIKE ? OR LOWER(job_title) LIKE ?",
			like, like, like, like)
	}
	if teamID != "" {
		if teamID == "none" {
			q = q.Where("team_id IS NULL")
		} else {
			q = q.Where("team_id = ?", teamID)
		}
	}
	if dept != "" {
		q = q.Where("department = ?", dept)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}

	var total int64
	q.Model(&models.Employee{}).Count(&total)

	var employees []models.Employee
	q.Preload("Team").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&employees)

	c.JSON(http.StatusOK, gin.H{
		"data":  employees,
		"total": total,
		"page":  page,
		"limit": limit,
		"pages": (total + int64(limit) - 1) / int64(limit),
	})
}

// Create handles POST /employees
func (h *EmployeeHandler) Create(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	var req EmployeeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orgUUID, _ := uuid.Parse(orgID)

	// Check email uniqueness within org
	var count int64
	h.db.Model(&models.Employee{}).Where("org_id = ? AND email = ?", orgID, req.Email).Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Employee with this email already exists"})
		return
	}

	status := models.StatusActive
	if req.Status != "" {
		status = models.UserStatus(req.Status)
	}

	var badgeID *uuid.UUID
	if req.EmployeeID != "" {
		if parsed, err := uuid.Parse(req.EmployeeID); err == nil {
			badgeID = &parsed
		}
	}
	if badgeID == nil {
		id := uuid.New()
		badgeID = &id
	}

	emp := models.Employee{
		OrgID:      orgUUID,
		FirstName:  req.FirstName,
		LastName:   req.LastName,
		Email:      req.Email,
		Phone:      req.Phone,
		Department: req.Department,
		JobTitle:   req.JobTitle,
		EmployeeID: badgeID,
		TeamID:     req.TeamID,
		Status:     status,
		AvatarURL:  req.AvatarURL,
	}

	if err := h.db.Create(&emp).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create employee"})
		return
	}

	h.logAudit(c, orgUUID, &uid, "create", "employee", &emp.ID, nil)

	h.db.Preload("Team").First(&emp, "id = ?", emp.ID)
	c.JSON(http.StatusCreated, emp)
}

// Get handles GET /employees/:id
func (h *EmployeeHandler) Get(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	empID := c.Param("id")

	var emp models.Employee
	if err := h.db.Where("id = ? AND org_id = ?", empID, orgID).
		Preload("Team").
		First(&emp).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Employee not found"})
		return
	}
	// Fetched manually rather than Preload("Devices"): Employee has its own
	// (unrelated, HRIS) EmployeeID field, which collides with GORM's
	// foreign-key auto-detection for this association.
	h.db.Where("employee_id = ?", emp.ID).Find(&emp.Devices)

	// Get recent activity count
	var activityCount int64
	h.db.Model(&models.ActivityEvent{}).
		Where("employee_id = ? AND timestamp > ?", emp.ID, time.Now().AddDate(0, 0, -30)).
		Count(&activityCount)

	c.JSON(http.StatusOK, gin.H{
		"employee":       emp,
		"activity_count": activityCount,
	})
}

// Update handles PUT /employees/:id
func (h *EmployeeHandler) Update(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	empID := c.Param("id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	var emp models.Employee
	if err := h.db.Where("id = ? AND org_id = ?", empID, orgID).First(&emp).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Employee not found"})
		return
	}

	var req EmployeeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check email uniqueness (exclude self)
	var count int64
	h.db.Model(&models.Employee{}).
		Where("org_id = ? AND email = ? AND id != ?", orgID, req.Email, empID).
		Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Email already used by another employee"})
		return
	}

	updates := map[string]any{
		"first_name": req.FirstName,
		"last_name":  req.LastName,
		"email":      req.Email,
		"phone":      req.Phone,
		"department": req.Department,
		"job_title":  req.JobTitle,
		"team_id":    req.TeamID,
		"avatar_url": req.AvatarURL,
	}
	if req.EmployeeID != "" {
		if parsed, err := uuid.Parse(req.EmployeeID); err == nil {
			updates["employee_id"] = parsed
		}
	}
	if req.Status != "" {
		updates["status"] = req.Status
	}

	if err := h.db.Model(&emp).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update employee"})
		return
	}

	orgUUID, _ := uuid.Parse(orgID)
	h.logAudit(c, orgUUID, &uid, "update", "employee", &emp.ID, updates)

	h.db.Preload("Team").First(&emp, "id = ?", emp.ID)
	c.JSON(http.StatusOK, emp)
}

// Delete handles DELETE /employees/:id
func (h *EmployeeHandler) Delete(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	empID := c.Param("id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	var emp models.Employee
	if err := h.db.Where("id = ? AND org_id = ?", empID, orgID).First(&emp).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Employee not found"})
		return
	}

	if err := h.db.Delete(&emp).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete employee"})
		return
	}

	orgUUID, _ := uuid.Parse(orgID)
	h.logAudit(c, orgUUID, &uid, "delete", "employee", &emp.ID, nil)

	c.JSON(http.StatusOK, gin.H{"message": "Employee deleted successfully"})
}

// BulkDelete handles DELETE /employees/bulk
func (h *EmployeeHandler) BulkDelete(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	var req struct {
		IDs []uuid.UUID `json:"ids" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := h.db.Where("id IN ? AND org_id = ?", req.IDs, orgID).Delete(&models.Employee{})
	c.JSON(http.StatusOK, gin.H{"deleted": result.RowsAffected})
}

// ImportCSV handles POST /employees/import
func (h *EmployeeHandler) ImportCSV(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	orgUUID, _ := uuid.Parse(orgID)

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CSV file required"})
		return
	}

	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open file"})
		return
	}
	defer f.Close()

	reader := csv.NewReader(f)
	records, err := reader.ReadAll()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid CSV format"})
		return
	}

	if len(records) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CSV must have header + at least one row"})
		return
	}

	created, skipped := 0, 0
	for _, row := range records[1:] { // skip header
		if len(row) < 3 {
			skipped++
			continue
		}
		email := strings.TrimSpace(row[2])
		if email == "" {
			skipped++
			continue
		}

		var count int64
		h.db.Model(&models.Employee{}).Where("org_id = ? AND email = ?", orgID, email).Count(&count)
		if count > 0 {
			skipped++
			continue
		}

		emp := models.Employee{
			OrgID:     orgUUID,
			FirstName: strings.TrimSpace(row[0]),
			LastName:  strings.TrimSpace(row[1]),
			Email:     email,
			Status:    models.StatusActive,
		}
		if len(row) > 3 { emp.Phone = strings.TrimSpace(row[3]) }
		if len(row) > 4 { emp.Department = strings.TrimSpace(row[4]) }
		if len(row) > 5 { emp.JobTitle = strings.TrimSpace(row[5]) }

		if err := h.db.Create(&emp).Error; err == nil {
			created++
		} else {
			skipped++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"created": created,
		"skipped": skipped,
		"total":   len(records) - 1,
	})
}

// ExportCSV handles GET /employees/export
func (h *EmployeeHandler) ExportCSV(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var employees []models.Employee
	h.db.Where("org_id = ?", orgID).Preload("Team").Find(&employees)

	c.Header("Content-Type", "text/csv")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="employees_%s.csv"`, time.Now().Format("20060102")))

	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"ID", "First Name", "Last Name", "Email", "Phone", "Department", "Job Title", "Team", "Status", "Risk Score", "Created At"})

	for _, e := range employees {
		teamName := ""
		if e.Team != nil {
			teamName = e.Team.Name
		}
		_ = w.Write([]string{
			e.ID.String(), e.FirstName, e.LastName, e.Email, e.Phone,
			e.Department, e.JobTitle, teamName, string(e.Status),
			fmt.Sprintf("%.2f", e.RiskScore), e.CreatedAt.Format(time.RFC3339),
		})
	}
	w.Flush()
}

// GetActivity handles GET /employees/:id/activity
func (h *EmployeeHandler) GetActivity(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	empID := c.Param("id")

	page, _  := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 { page = 1 }
	if limit > 100 { limit = 100 }

	var total int64
	var events []models.ActivityEvent

	h.db.Model(&models.ActivityEvent{}).Where("org_id = ? AND employee_id = ?", orgID, empID).Count(&total)
	h.db.Where("org_id = ? AND employee_id = ?", orgID, empID).
		Order("timestamp DESC").
		Offset((page-1)*limit).Limit(limit).
		Find(&events)

	c.JSON(http.StatusOK, gin.H{
		"data":  events,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// Departments handles GET /employees/departments
func (h *EmployeeHandler) Departments(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	var departments []string
	h.db.Model(&models.Employee{}).
		Where("org_id = ? AND department != ''", orgID).
		Distinct("department").
		Pluck("department", &departments)
	c.JSON(http.StatusOK, departments)
}

func (h *EmployeeHandler) logAudit(c *gin.Context, orgID uuid.UUID, userID *uuid.UUID, action, resource string, resourceID *uuid.UUID, changes map[string]any) {
	log := models.AuditLog{
		OrgID:      &orgID,
		UserID:     userID,
		Action:     action,
		Resource:   resource,
		ResourceID: resourceID,
		Changes:    changes,
		IPAddress:  c.ClientIP(),
		UserAgent:  c.GetHeader("User-Agent"),
	}
	h.db.Create(&log)
}
