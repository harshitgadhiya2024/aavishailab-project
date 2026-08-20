package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type PolicyHandler struct {
	db *gorm.DB
}

func NewPolicyHandler(db *gorm.DB) *PolicyHandler {
	return &PolicyHandler{db: db}
}

// TestDLP handles POST /dlp/test — the dashboard "test a sample" tool. It runs
// a piece of pasted text through the org's DLP scoring (a specific policy if
// policy_id is given, otherwise all enabled DLP policies) and returns the
// score, band, and masked matches — so an admin can see exactly what a policy
// would do before enforcing it. No content is persisted.
func (h *PolicyHandler) TestDLP(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	if orgID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "No organization context"})
		return
	}

	var req struct {
		Text        string `json:"text"`
		PolicyID    string `json:"policy_id"`
		Filename    string `json:"filename"`
		ContentType string `json:"content_type"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	q := h.db.Where("org_id = ? AND type = ?", orgID, models.PolicyTypeDLP)
	if req.PolicyID != "" {
		// Testing a single policy — include it even if currently disabled, so
		// an admin can validate a policy before turning it on.
		q = q.Where("id = ?", req.PolicyID)
	} else {
		q = q.Where("enabled = true")
	}
	var policies []models.Policy
	q.Order("priority ASC").Find(&policies)

	filename := req.Filename
	if filename == "" {
		filename = "sample.txt"
	}
	contentType := req.ContentType
	if contentType == "" {
		contentType = "text/plain"
	}

	v := scanDLPContent(orgID, filename, contentType, "test-sample", []byte(req.Text), policies)

	c.JSON(http.StatusOK, gin.H{
		"matched":     v.matched,
		"score":       v.score,
		"band":        v.band,
		"action":      v.action,
		"policy_name": v.policyName,
		"detectors":   v.detectors,
		"matches":     v.previews,
		"reason":      v.reason,
		"policies_evaluated": len(policies),
	})
}

type PolicyRequest struct {
	Name        string            `json:"name" binding:"required"`
	Description string            `json:"description"`
	Type        models.PolicyType `json:"type"`
	PolicyType  models.PolicyType `json:"policy_type"`
	Action      string            `json:"action"`
	Priority    int               `json:"priority"`
	Enabled     *bool             `json:"enabled"`
	Rules       map[string]any    `json:"rules"`
	Targets     map[string]any    `json:"targets"`
}

func (r *PolicyRequest) resolvedType() models.PolicyType {
	if r.Type != "" {
		return r.Type
	}
	return r.PolicyType
}

func (r *PolicyRequest) validate() error {
	if r.resolvedType() == "" {
		return fmt.Errorf("policy type is required")
	}
	return nil
}

// List handles GET /policies
func (h *PolicyHandler) List(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	page, _   := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _  := strconv.Atoi(c.DefaultQuery("limit", "20"))
	pType     := c.Query("type")
	enabled   := c.Query("enabled")
	search    := c.Query("search")

	if page < 1 { page = 1 }
	if limit > 100 { limit = 100 }

	q := h.db.Where("org_id = ?", orgID)
	if pType != "" {
		q = q.Where("type = ?", pType)
	}
	if enabled != "" {
		q = q.Where("enabled = ?", enabled == "true")
	}
	if search != "" {
		q = q.Where("LOWER(name) LIKE ? OR LOWER(description) LIKE ?",
			"%"+search+"%", "%"+search+"%")
	}

	var total int64
	q.Model(&models.Policy{}).Count(&total)

	var policies []models.Policy
	q.Order("priority ASC, created_at DESC").
		Offset((page-1)*limit).Limit(limit).
		Find(&policies)

	c.JSON(http.StatusOK, gin.H{
		"data":  policies,
		"total": total,
		"page":  page,
		"limit": limit,
		"pages": (total + int64(limit) - 1) / int64(limit),
	})
}

// Create handles POST /policies
func (h *PolicyHandler) Create(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)
	orgUUID, _ := uuid.Parse(orgID)

	var req PolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := req.validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	action := models.PolicyActionBlock
	if req.Action != "" {
		action = models.PolicyAction(req.Action)
	}
	priority := 100
	if req.Priority > 0 {
		priority = req.Priority
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	if req.Rules == nil {
		req.Rules = map[string]any{}
	}
	if req.Targets == nil {
		req.Targets = map[string]any{"scope": "all"}
	}

	policy := models.Policy{
		OrgID:       orgUUID,
		Name:        req.Name,
		Description: req.Description,
		Type:        req.resolvedType(),
		Action:      action,
		Priority:    priority,
		Enabled:     enabled,
		Rules:       req.Rules,
		Targets:     req.Targets,
		CreatedBy:   &uid,
		UpdatedBy:   &uid,
	}

	// Generate Rego bundle
	policy.RegoBundle = generateRegoBundle(&policy)

	if err := h.db.Create(&policy).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create policy"})
		return
	}

	h.db.Create(&models.AuditLog{
		OrgID: &orgUUID, UserID: &uid,
		Action: "create", Resource: "policy", ResourceID: &policy.ID,
		IPAddress: c.ClientIP(),
	})

	c.JSON(http.StatusCreated, policy)
}

// Get handles GET /policies/:id
func (h *PolicyHandler) Get(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	policyID := c.Param("id")

	var policy models.Policy
	if err := h.db.Where("id = ? AND org_id = ?", policyID, orgID).First(&policy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}
	c.JSON(http.StatusOK, policy)
}

// ResolvedDomains handles GET /policies/:id/resolved-domains
// Expands a policy's domain/category conditions into the concrete list of
// domains it actually covers — backs the "expand row to see domains" view
// in the policy list, for both plain domain conditions and category ones
// (where the admin set "block category: Gambling" and wants to see exactly
// which sites that resolves to).
func (h *PolicyHandler) ResolvedDomains(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	policyID := c.Param("id")

	var policy models.Policy
	if err := h.db.Where("id = ? AND org_id = ?", policyID, orgID).First(&policy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	domains := ResolvePolicyDomains(h.db, policy)
	c.JSON(http.StatusOK, gin.H{"domains": domains})
}

// Update handles PUT /policies/:id
func (h *PolicyHandler) Update(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	policyID := c.Param("id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	var policy models.Policy
	if err := h.db.Where("id = ? AND org_id = ?", policyID, orgID).First(&policy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	var req PolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := req.validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]any{
		"name":        req.Name,
		"description": req.Description,
		"type":        req.resolvedType(),
		"version":     policy.Version + 1,
		"updated_by":  uid,
	}
	if req.Action != "" { updates["action"] = req.Action }
	if req.Priority > 0 { updates["priority"] = req.Priority }
	if req.Enabled != nil { updates["enabled"] = *req.Enabled }
	if req.Rules != nil { updates["rules"] = req.Rules }
	if req.Targets != nil { updates["targets"] = req.Targets }

	h.db.Model(&policy).Updates(updates)

	// Regenerate Rego bundle
	h.db.Model(&policy).Update("rego_bundle", generateRegoBundle(&policy))

	orgUUID, _ := uuid.Parse(orgID)
	h.db.Create(&models.AuditLog{
		OrgID: &orgUUID, UserID: &uid,
		Action: "update", Resource: "policy", ResourceID: &policy.ID,
		IPAddress: c.ClientIP(),
	})

	h.db.First(&policy, "id = ?", policy.ID)
	c.JSON(http.StatusOK, policy)
}

// Delete handles DELETE /policies/:id
func (h *PolicyHandler) Delete(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	policyID := c.Param("id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	var policy models.Policy
	if err := h.db.Where("id = ? AND org_id = ?", policyID, orgID).First(&policy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	h.db.Where("policy_id = ?", policyID).Delete(&models.PolicyAssignment{})
	h.db.Delete(&policy)

	orgUUID, _ := uuid.Parse(orgID)
	h.db.Create(&models.AuditLog{
		OrgID: &orgUUID, UserID: &uid,
		Action: "delete", Resource: "policy", ResourceID: &policy.ID,
		IPAddress: c.ClientIP(),
	})

	c.JSON(http.StatusOK, gin.H{"message": "Policy deleted"})
}

// Toggle handles PATCH /policies/:id/toggle
func (h *PolicyHandler) Toggle(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	policyID := c.Param("id")

	var policy models.Policy
	if err := h.db.Where("id = ? AND org_id = ?", policyID, orgID).First(&policy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	h.db.Model(&policy).Update("enabled", !policy.Enabled)
	c.JSON(http.StatusOK, gin.H{"enabled": !policy.Enabled})
}

// Duplicate handles POST /policies/:id/duplicate
func (h *PolicyHandler) Duplicate(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	policyID := c.Param("id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)
	orgUUID, _ := uuid.Parse(orgID)

	var original models.Policy
	if err := h.db.Where("id = ? AND org_id = ?", policyID, orgID).First(&original).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	copy := models.Policy{
		OrgID:       orgUUID,
		Name:        "Copy of " + original.Name,
		Description: original.Description,
		Type:        original.Type,
		Action:      original.Action,
		Priority:    original.Priority + 1,
		Enabled:     false, // disable copy by default
		Rules:       original.Rules,
		Targets:     original.Targets,
		CreatedBy:   &uid,
		UpdatedBy:   &uid,
	}
	copy.RegoBundle = generateRegoBundle(&copy)

	if err := h.db.Create(&copy).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to duplicate policy"})
		return
	}

	c.JSON(http.StatusCreated, copy)
}

// Export handles GET /policies/export
func (h *PolicyHandler) Export(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var policies []models.Policy
	h.db.Where("org_id = ?", orgID).Find(&policies)

	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="policies_%s.json"`, time.Now().Format("20060102")))
	c.JSON(http.StatusOK, policies)
}

// Import handles POST /policies/import
func (h *PolicyHandler) Import(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)
	orgUUID, _ := uuid.Parse(orgID)

	var policies []PolicyRequest
	if err := c.ShouldBindJSON(&policies); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	created := 0
	for _, req := range policies {
		policy := models.Policy{
			OrgID:       orgUUID,
			Name:        req.Name,
			Description: req.Description,
			Type:        req.resolvedType(),
			Action:      models.PolicyAction(req.Action),
			Enabled:     false, // import as disabled
			Rules:       req.Rules,
			Targets:     req.Targets,
			CreatedBy:   &uid,
		}
		if err := h.db.Create(&policy).Error; err == nil {
			created++
		}
	}

	c.JSON(http.StatusOK, gin.H{"created": created})
}

// Assign handles POST /policies/:id/assign
func (h *PolicyHandler) Assign(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	policyID := c.Param("id")
	orgUUID, _ := uuid.Parse(orgID)
	policyUUID, _ := uuid.Parse(policyID)

	var req struct {
		TargetType  string     `json:"target_type"`
		Target      string     `json:"target"`
		TargetID    *uuid.UUID `json:"target_id"`
		TeamID      string     `json:"team_id"`
		TargetValue string     `json:"target_value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	targetType := req.TargetType
	if targetType == "" {
		targetType = req.Target
	}
	if targetType == "" {
		targetType = "all"
	}

	var targetID *uuid.UUID
	if req.TargetID != nil {
		targetID = req.TargetID
	} else if req.TeamID != "" {
		if id, err := uuid.Parse(req.TeamID); err == nil {
			targetID = &id
		}
	}

	// Verify policy belongs to org
	var policy models.Policy
	if err := h.db.Where("id = ? AND org_id = ?", policyID, orgID).First(&policy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Policy not found"})
		return
	}

	assignment := models.PolicyAssignment{
		PolicyID:    policyUUID,
		OrgID:       orgUUID,
		TargetType:  targetType,
		TargetID:    targetID,
		TargetValue: req.TargetValue,
	}

	if err := h.db.Create(&assignment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to assign policy"})
		return
	}

	c.JSON(http.StatusCreated, assignment)
}

// GetTypes handles GET /policies/types
func (h *PolicyHandler) GetTypes(c *gin.Context) {
	types := []map[string]string{
		{"value": "url_category", "label": "URL Category Block", "description": "Block websites by category (social media, gambling, etc.)"},
		{"value": "domain", "label": "Domain Block/Allow", "description": "Block or allow specific domains"},
		{"value": "application", "label": "Application Control", "description": "Block or allow specific applications"},
		{"value": "usb", "label": "USB/Device Control", "description": "Control USB storage and peripheral devices"},
		{"value": "dlp", "label": "Data Loss Prevention", "description": "Prevent sensitive data from being sent outside"},
		{"value": "time_based", "label": "Time-Based Access", "description": "Restrict access during specific hours"},
		{"value": "process", "label": "Process Control", "description": "Block specific system processes or commands"},
	}
	c.JSON(http.StatusOK, types)
}

// generateRegoBundle creates an OPA Rego policy from the policy struct
func generateRegoBundle(p *models.Policy) string {
	rulesJSON, _ := json.MarshalIndent(p.Rules, "    ", "    ")

	rego := fmt.Sprintf(`package aavishield.policy.%s

import future.keywords.if
import future.keywords.in

# Policy: %s
# Type: %s | Action: %s

default decision = {"action": "allow", "reason": "no matching policy"}

decision = result if {
    matches_policy
    result := {"action": "%s", "policy_id": "%s", "policy_name": "%s", "reason": "Matched policy: %s"}
}

# Policy rules
policy_rules := %s

matches_policy if {
    policy_rules.enabled == true
}
`, p.ID.String(), p.Name, p.Type, p.Action,
		p.Action, p.ID.String(), p.Name, p.Name,
		string(rulesJSON))

	return rego
}
