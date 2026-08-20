package handlers

import (
	"net/http"
	"strings"

	"github.com/aavishield/admin-api/internal/casbclient"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CASBHandler serves the dashboard's CASB tools and the org's own app-control
// rules. Requests to casb-service are authenticated pass-throughs: the org is
// taken from the JWT scope (never trusted from the body), and the org's rules
// are attached server-side so a caller can't evaluate against someone else's
// policy — or against none at all.
type CASBHandler struct {
	db *gorm.DB
}

func NewCASBHandler(db *gorm.DB) *CASBHandler { return &CASBHandler{db: db} }

var casbActivities = map[string]bool{
	"upload": true, "download": true, "share": true, "post": true, "login": true, "any": true,
}

var casbActions = map[models.PolicyAction]bool{
	models.PolicyActionBlock: true,
	models.PolicyActionAlert: true,
	models.PolicyActionAllow: true,
}

// casbRulePayload converts stored rules into the shape casb-service expects.
// Empty string / nil match fields are omitted entirely so the service reads
// them as wildcards rather than as a literal "" to compare against.
func casbRulePayload(rules []models.CASBRule) []map[string]any {
	out := make([]map[string]any, 0, len(rules))
	for _, r := range rules {
		item := map[string]any{
			"name":     r.Name,
			"activity": r.Activity,
			"action":   string(r.Action),
		}
		if r.Category != "" {
			item["category"] = r.Category
		}
		if r.App != "" {
			item["app"] = r.App
		}
		if r.Sanctioned != nil {
			item["sanctioned"] = *r.Sanctioned
		}
		if r.MinRisk != nil {
			item["min_risk"] = *r.MinRisk
		}
		out = append(out, item)
	}
	return out
}

// orgCASBRules loads an org's enabled rules in evaluation order.
func orgCASBRules(db *gorm.DB, orgID string) []models.CASBRule {
	var rules []models.CASBRule
	db.Where("org_id = ? AND enabled = true", orgID).
		Order("priority ASC, created_at ASC").
		Find(&rules)
	return rules
}

// AppControl handles POST /casb/app-control — evaluate a SaaS activity against
// inline app-control policy (dashboard "what would happen" tool).
func (h *CASBHandler) AppControl(c *gin.Context) {
	h.proxy(c, "/v1/app-control", true)
}

// OOBAnalyze handles POST /casb/oob/analyze — out-of-band scan of a submitted
// cloud file inventory for risky shares.
func (h *CASBHandler) OOBAnalyze(c *gin.Context) {
	h.proxy(c, "/v1/oob/analyze", false)
}

func (h *CASBHandler) proxy(c *gin.Context, path string, withRules bool) {
	orgID := c.GetString("scoped_org_id")
	if orgID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "No organization context"})
		return
	}
	if !casbclient.Enabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "casb-service is not configured"})
		return
	}

	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		body = map[string]any{}
	}
	body["org_id"] = orgID // scope from JWT, not the client body

	// The tester must answer with the same policy the agents enforce, so the
	// org's rules come from the database rather than from the request.
	if withRules {
		body["rules"] = casbRulePayload(orgCASBRules(h.db, orgID))
	}

	status, resp, err := casbclient.Post(orgID, path, body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "casb-service unavailable"})
		return
	}
	c.JSON(status, resp)
}

// ─── App-control rules CRUD ───────────────────────────────────────────────────

type casbRuleRequest struct {
	Name       string `json:"name" binding:"required"`
	Category   string `json:"category"`
	App        string `json:"app"`
	Activity   string `json:"activity"`
	Sanctioned *bool  `json:"sanctioned"`
	MinRisk    *int   `json:"min_risk"`
	Action     string `json:"action" binding:"required"`
	Priority   int    `json:"priority"`
	Enabled    *bool  `json:"enabled"`
}

func (r *casbRuleRequest) normalize() error {
	r.Name = strings.TrimSpace(r.Name)
	r.Category = strings.ToLower(strings.TrimSpace(r.Category))
	r.App = strings.TrimSpace(r.App)
	r.Activity = strings.ToLower(strings.TrimSpace(r.Activity))
	if r.Activity == "" {
		r.Activity = "any"
	}
	if !casbActivities[r.Activity] {
		return errInvalidActivity
	}
	if !casbActions[models.PolicyAction(strings.ToLower(strings.TrimSpace(r.Action)))] {
		return errInvalidAction
	}
	r.Action = strings.ToLower(strings.TrimSpace(r.Action))
	if r.MinRisk != nil && (*r.MinRisk < 0 || *r.MinRisk > 100) {
		return errInvalidRisk
	}
	if r.Priority <= 0 {
		r.Priority = 100
	}
	return nil
}

var (
	errInvalidActivity = &casbValidationError{"activity must be one of upload, download, share, post, login, any"}
	errInvalidAction   = &casbValidationError{"action must be block, alert or allow"}
	errInvalidRisk     = &casbValidationError{"min_risk must be between 0 and 100"}
)

type casbValidationError struct{ msg string }

func (e *casbValidationError) Error() string { return e.msg }

// ListRules handles GET /casb/rules
func (h *CASBHandler) ListRules(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var rules []models.CASBRule
	h.db.Where("org_id = ?", orgID).
		Order("priority ASC, created_at ASC").
		Find(&rules)

	// The built-in fallbacks are shown alongside so an admin can see the whole
	// evaluation order, not just their half of it.
	c.JSON(http.StatusOK, gin.H{
		"data":          rules,
		"total":         len(rules),
		"default_rules": casbDefaultRuleSummary(),
	})
}

// casbDefaultRuleSummary mirrors casb-service's DEFAULT_RULES for display.
// Kept here (rather than fetched) so the page still explains enforcement when
// casb-service is unreachable; it is documentation, not the decision path.
func casbDefaultRuleSummary() []gin.H {
	return []gin.H{
		{"name": "Block uploads to personal file-transfer sites", "action": "block", "activity": "upload", "category": "file_transfer"},
		{"name": "Block uploads to high-risk unsanctioned apps", "action": "block", "activity": "upload", "min_risk": 60, "sanctioned": false},
		{"name": "Alert on uploads to unsanctioned apps", "action": "alert", "activity": "upload", "sanctioned": false},
		{"name": "Alert on uploads to AI tools", "action": "alert", "activity": "upload", "category": "ai_tools"},
		{"name": "Alert on data pasted into AI tools", "action": "alert", "activity": "post", "category": "ai_tools"},
		{"name": "Alert on high-risk unsanctioned app usage", "action": "alert", "activity": "any", "min_risk": 60, "sanctioned": false},
	}
}

// CreateRule handles POST /casb/rules
func (h *CASBHandler) CreateRule(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "No organization context"})
		return
	}

	var req casbRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := req.normalize(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	rule := models.CASBRule{
		OrgID:      orgID,
		Name:       req.Name,
		Category:   req.Category,
		App:        req.App,
		Activity:   req.Activity,
		Sanctioned: req.Sanctioned,
		MinRisk:    req.MinRisk,
		Action:     models.PolicyAction(req.Action),
		Priority:   req.Priority,
		Enabled:    enabled,
	}
	if err := h.db.Create(&rule).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create rule"})
		return
	}
	c.JSON(http.StatusCreated, rule)
}

// UpdateRule handles PUT /casb/rules/:id
func (h *CASBHandler) UpdateRule(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var rule models.CASBRule
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&rule).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Rule not found"})
		return
	}

	var req casbRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := req.normalize(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	enabled := rule.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	// Updates() skips nil-pointer fields in a struct, so the nullable
	// "any" matchers are written through a map to make clearing them stick.
	if err := h.db.Model(&rule).Updates(map[string]any{
		"name":       req.Name,
		"category":   req.Category,
		"app":        req.App,
		"activity":   req.Activity,
		"sanctioned": req.Sanctioned,
		"min_risk":   req.MinRisk,
		"action":     models.PolicyAction(req.Action),
		"priority":   req.Priority,
		"enabled":    enabled,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update rule"})
		return
	}

	h.db.Where("id = ?", rule.ID).First(&rule)
	c.JSON(http.StatusOK, rule)
}

// ToggleRule handles PATCH /casb/rules/:id/toggle
func (h *CASBHandler) ToggleRule(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var rule models.CASBRule
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&rule).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Rule not found"})
		return
	}
	// Capture the target state first: Update() writes back into the struct, so
	// reading rule.Enabled afterwards reports the value we just set, not the
	// one before it.
	next := !rule.Enabled
	h.db.Model(&rule).Update("enabled", next)
	c.JSON(http.StatusOK, gin.H{"id": rule.ID, "enabled": next})
}

// DeleteRule handles DELETE /casb/rules/:id
func (h *CASBHandler) DeleteRule(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	result := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).Delete(&models.CASBRule{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Rule not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Rule deleted"})
}
