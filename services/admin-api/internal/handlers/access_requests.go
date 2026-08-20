package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/notifier"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AccessRequestHandler manages employee-initiated requests to access a site
// a policy blocked them from, and the company-side approve/deny workflow.
// An approved request IS the exception applied in agents.go's GetRules —
// there's no separate exception table to keep in sync.
type AccessRequestHandler struct {
	db *gorm.DB
}

func NewAccessRequestHandler(db *gorm.DB) *AccessRequestHandler {
	return &AccessRequestHandler{db: db}
}

// ─── Employee portal ──────────────────────────────────────────────────────────

// Create handles POST /api/v1/portal/access-requests
// Employee asks for access to a domain a specific policy blocked them from.
func (h *AccessRequestHandler) Create(c *gin.Context) {
	empIDStr, exists := c.Get("portal_employee_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Employee portal authentication required"})
		return
	}
	orgIDStr, _ := c.Get("portal_org_id")

	var req struct {
		PolicyID string `json:"policy_id" binding:"required"`
		Domain   string `json:"domain" binding:"required"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	empID, err := uuid.Parse(empIDStr.(string))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid employee session"})
		return
	}
	orgID, err := uuid.Parse(orgIDStr.(string))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid org session"})
		return
	}
	policyID, err := uuid.Parse(req.PolicyID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid policy_id"})
		return
	}

	var policy models.Policy
	if err := h.db.Where("id = ? AND org_id = ?", policyID, orgID).First(&policy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	// Only allow requesting access for a domain this employee was actually
	// blocked on — an employee can't fish for access to sites they never hit.
	var blockedCount int64
	h.db.Model(&models.ActivityEvent{}).
		Where("employee_id = ? AND policy_id = ? AND action = 'blocked' AND target_domain = ?", empID, policyID, req.Domain).
		Count(&blockedCount)
	if blockedCount == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "No blocked activity found for this domain under this policy"})
		return
	}

	// Don't pile up duplicate pending requests for the same (employee, policy, domain).
	var existing models.AccessRequest
	err = h.db.Where("employee_id = ? AND policy_id = ? AND domain = ? AND status = ?",
		empID, policyID, req.Domain, models.AccessRequestPending).First(&existing).Error
	if err == nil {
		c.JSON(http.StatusOK, existing)
		return
	}

	request := models.AccessRequest{
		OrgID:      orgID,
		EmployeeID: empID,
		PolicyID:   policyID,
		Domain:     req.Domain,
		Reason:     req.Reason,
		Status:     models.AccessRequestPending,
	}
	if err := h.db.Create(&request).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create access request"})
		return
	}

	// An employee is now blocked from something they say they need for work —
	// that waits on a human, so tell the humans immediately.
	var reqOrg models.Organization
	notifyAdmins := true
	if err := h.db.First(&reqOrg, "id = ?", orgID).Error; err == nil {
		notifyAdmins = reqOrg.WantsNotification("access_requests")
	}
	if admins := notifier.AdminEmails(h.db, orgID.String()); notifyAdmins && len(admins) > 0 {
		var emp models.Employee
		name, email := "An employee", ""
		if err := h.db.First(&emp, "id = ?", empID).Error; err == nil {
			name, email = emp.FullName(), emp.Email
		}
		mailer.AccessRequestSubmitted(admins, name, email, req.Domain, req.Reason, policy.Name)
	}

	c.JSON(http.StatusCreated, request)
}

// ListMine handles GET /api/v1/portal/access-requests
func (h *AccessRequestHandler) ListMine(c *gin.Context) {
	empIDStr, exists := c.Get("portal_employee_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Employee portal authentication required"})
		return
	}

	var requests []models.AccessRequest
	h.db.Where("employee_id = ?", empIDStr).
		Preload("Policy").
		Order("created_at DESC").
		Find(&requests)
	c.JSON(http.StatusOK, gin.H{"data": requests})
}

// ─── Company dashboard ─────────────────────────────────────────────────────────

// List handles GET /api/v1/access-requests
func (h *AccessRequestHandler) List(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit > 200 {
		limit = 200
	}

	q := h.db.Where("org_id = ?", orgID)
	if status := c.Query("status"); status != "" {
		q = q.Where("status = ?", status)
	}
	if policyID := c.Query("policy_id"); policyID != "" {
		q = q.Where("policy_id = ?", policyID)
	}

	var total int64
	q.Session(&gorm.Session{}).Model(&models.AccessRequest{}).Count(&total)

	var requests []models.AccessRequest
	q.Session(&gorm.Session{}).
		Preload("Employee").Preload("Policy").
		Order("created_at DESC").
		Offset((page - 1) * limit).Limit(limit).
		Find(&requests)

	c.JSON(http.StatusOK, gin.H{
		"data": requests, "total": total, "page": page, "limit": limit,
		"pages": (total + int64(limit) - 1) / int64(limit),
	})
}

// BlockedEmployees handles GET /api/v1/policies/:id/blocked-employees
// Lists employees who have actually been blocked by this policy at least
// once — the picker for granting access is restricted to this list, so an
// admin can't grant an exception to someone the policy never affected.
func (h *AccessRequestHandler) BlockedEmployees(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	policyID := c.Param("id")

	var policy models.Policy
	if err := h.db.Where("id = ? AND org_id = ?", policyID, orgID).First(&policy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	type blockedEmp struct {
		EmployeeID   uuid.UUID `json:"employee_id"`
		FirstName    string    `json:"first_name"`
		LastName     string    `json:"last_name"`
		Email        string    `json:"email"`
		TargetDomain string    `json:"target_domain"`
		LastBlockedAt time.Time `json:"last_blocked_at"`
	}
	var rows []blockedEmp
	h.db.Raw(`
		SELECT DISTINCT ON (ae.employee_id, ae.target_domain)
			ae.employee_id, e.first_name, e.last_name, e.email, ae.target_domain,
			ae.timestamp as last_blocked_at
		FROM activity_events ae
		JOIN employees e ON e.id = ae.employee_id
		WHERE ae.policy_id = ? AND ae.action = 'blocked' AND ae.employee_id IS NOT NULL
		ORDER BY ae.employee_id, ae.target_domain, ae.timestamp DESC
	`, policyID).Scan(&rows)

	c.JSON(http.StatusOK, gin.H{"data": rows})
}

// Approve handles POST /api/v1/access-requests/:id/approve
func (h *AccessRequestHandler) Approve(c *gin.Context) {
	h.resolve(c, models.AccessRequestApproved)
}

// Deny handles POST /api/v1/access-requests/:id/deny
func (h *AccessRequestHandler) Deny(c *gin.Context) {
	h.resolve(c, models.AccessRequestDenied)
}

func (h *AccessRequestHandler) resolve(c *gin.Context, status models.AccessRequestStatus) {
	orgID := c.GetString("scoped_org_id")
	reqID := c.Param("id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	var req struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)

	var ar models.AccessRequest
	if err := h.db.Where("id = ? AND org_id = ?", reqID, orgID).First(&ar).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Access request not found"})
		return
	}

	now := time.Now()
	updates := map[string]any{
		"status":      status,
		"reviewed_by": uid,
		"reviewed_at": now,
		"review_note": req.Note,
	}
	if err := h.db.Model(&ar).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update access request"})
		return
	}

	orgUUID, _ := uuid.Parse(orgID)
	h.db.Create(&models.AuditLog{
		OrgID: &orgUUID, UserID: &uid,
		Action: string(status), Resource: "access_request", ResourceID: &ar.ID,
		IPAddress: c.ClientIP(),
	})

	h.db.First(&ar, "id = ?", ar.ID)

	// The employee is waiting on this answer — tell them rather than making
	// them re-check the portal.
	var emp models.Employee
	if err := h.db.First(&emp, "id = ?", ar.EmployeeID).Error; err == nil && emp.Email != "" {
		mailer.AccessRequestResolved(emp.Email, emp.FirstName, ar.Domain,
			status == models.AccessRequestApproved, req.Note)
	}

	c.JSON(http.StatusOK, ar)
}
