package handlers

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AppControlHandler struct{ db *gorm.DB }

func NewAppControlHandler(db *gorm.DB) *AppControlHandler { return &AppControlHandler{db: db} }

// ─── Shared resolution (used by the agent feed and by the rules API) ─────────

// activeAppRules returns an org's enabled rules with their applications
// loaded, filtered to the ones that apply to this employee/team.
func activeAppRules(db *gorm.DB, orgID uuid.UUID, employeeID, teamID *uuid.UUID) []models.AppControlRule {
	var rules []models.AppControlRule
	db.Preload("Application").
		Where("org_id = ? AND enabled = true", orgID).
		Find(&rules)

	out := rules[:0]
	for _, r := range rules {
		if r.Application == nil {
			continue
		}
		if !policyTargetMatches(r.Targets, employeeID, teamID) {
			continue
		}
		out = append(out, r)
	}
	return out
}

// appControlDomainRules turns the network half of each rule into the same
// DomainRule shape the agent already enforces. This is the domain bundle:
// one rule for "ChatGPT" contributes every host the desktop client talks to,
// which is what makes an already-installed copy useless rather than merely
// inconvenienced.
func appControlDomainRules(db *gorm.DB, orgID uuid.UUID, employeeID, teamID *uuid.UUID) []models.DomainRule {
	var out []models.DomainRule
	org := orgID
	for _, r := range activeAppRules(db, orgID, employeeID, teamID) {
		if !r.BlockNetwork {
			continue
		}
		action := models.PolicyActionBlock
		if r.Action == "alert" {
			action = models.PolicyActionAlert
		}
		for _, domain := range r.Application.Domains {
			domain = strings.ToLower(strings.TrimSpace(domain))
			if domain == "" {
				continue
			}
			out = append(out, models.DomainRule{
				Base:     models.Base{ID: r.ID},
				OrgID:    &org,
				Domain:   domain,
				Action:   action,
				Category: r.Application.Category,
				Reason:   "Application control: " + r.Application.Name,
				Enabled:  true,
			})
		}
	}
	return out
}

// appControlMatchers is the process half — what the agent's watcher compares
// running processes against.
func appControlMatchers(db *gorm.DB, orgID uuid.UUID, employeeID, teamID *uuid.UUID) []models.AppControlMatcher {
	out := []models.AppControlMatcher{}
	for _, r := range activeAppRules(db, orgID, employeeID, teamID) {
		if !r.BlockProcess {
			continue
		}
		app := r.Application
		if len(app.ProcessNames) == 0 && len(app.BundleIDs) == 0 && len(app.PathPatterns) == 0 {
			continue // nothing to match on — a web-only app
		}
		out = append(out, models.AppControlMatcher{
			AppID:        app.ID.String(),
			Name:         app.Name,
			Action:       r.Action,
			ProcessNames: app.ProcessNames,
			BundleIDs:    app.BundleIDs,
			PathPatterns: app.PathPatterns,
		})
	}
	return out
}

// ─── Company API ─────────────────────────────────────────────────────────────

// Catalog handles GET /applications/catalog — every application this org can
// control: the built-in list plus anything it defined itself.
func (h *AppControlHandler) Catalog(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var apps []models.ManagedApplication
	h.db.Where("org_id IS NULL OR org_id = ?", orgID).
		Order("category ASC, name ASC").Find(&apps)

	// Which ones already have a rule, so the UI can show state in one request.
	var rules []models.AppControlRule
	h.db.Where("org_id = ?", orgID).Find(&rules)
	byApp := make(map[uuid.UUID]models.AppControlRule, len(rules))
	for _, r := range rules {
		byApp[r.ApplicationID] = r
	}

	type entry struct {
		models.ManagedApplication
		Rule *models.AppControlRule `json:"rule,omitempty"`
	}
	out := make([]entry, 0, len(apps))
	categories := map[string]int{}
	for _, a := range apps {
		e := entry{ManagedApplication: a}
		if r, ok := byApp[a.ID]; ok {
			rc := r
			e.Rule = &rc
		}
		out = append(out, e)
		categories[a.Category]++
	}

	cats := make([]string, 0, len(categories))
	for k := range categories {
		cats = append(cats, k)
	}
	sort.Strings(cats)

	c.JSON(http.StatusOK, gin.H{
		"applications": out,
		"categories":   cats,
		"total":        len(out),
	})
}

// ListRules handles GET /applications/rules
func (h *AppControlHandler) ListRules(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var rules []models.AppControlRule
	h.db.Preload("Application").Where("org_id = ?", orgID).
		Order("created_at DESC").Find(&rules)

	c.JSON(http.StatusOK, gin.H{"rules": rules, "total": len(rules)})
}

type appRuleInput struct {
	ApplicationID string         `json:"application_id" binding:"required"`
	Action        string         `json:"action"`
	Enabled       *bool          `json:"enabled"`
	BlockNetwork  *bool          `json:"block_network"`
	BlockProcess  *bool          `json:"block_process"`
	Targets       map[string]any `json:"targets"`
}

// CreateRule handles POST /applications/rules — idempotent per application, so
// the UI can treat "control this app" as a single toggle.
func (h *AppControlHandler) CreateRule(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var in appRuleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	appID, err := uuid.Parse(in.ApplicationID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid application_id"})
		return
	}

	var app models.ManagedApplication
	if err := h.db.Where("id = ? AND (org_id IS NULL OR org_id = ?)", appID, orgID).
		First(&app).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Application not found"})
		return
	}

	action := strings.ToLower(strings.TrimSpace(in.Action))
	if action != "alert" {
		action = "block"
	}

	rule := models.AppControlRule{
		OrgID:         orgID,
		ApplicationID: appID,
		Action:        action,
		Enabled:       boolOr(in.Enabled, true),
		BlockNetwork:  boolOr(in.BlockNetwork, true),
		BlockProcess:  boolOr(in.BlockProcess, false),
		Targets:       in.Targets,
	}

	// Unscoped: a rule the company removed earlier is still on disk, and the
	// unique index counts it. Revive that row rather than failing to insert a
	// second one.
	var existing models.AppControlRule
	err = h.db.Unscoped().Where("org_id = ? AND application_id = ?", orgID, appID).First(&existing).Error
	if err == nil {
		// Save rather than a map-based Updates: Targets carries a JSON
		// serializer that a map update bypasses, and Save clears deleted_at in
		// the same statement.
		rule.ID = existing.ID
		rule.CreatedAt = existing.CreatedAt
		if err := h.db.Unscoped().Save(&rule).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update the rule"})
			return
		}
		h.db.Preload("Application").First(&existing, "id = ?", existing.ID)
		c.JSON(http.StatusOK, existing)
		return
	}
	if err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to look up the rule"})
		return
	}

	if err := h.db.Create(&rule).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create the rule"})
		return
	}
	rule.Application = &app
	c.JSON(http.StatusCreated, rule)
}

// UpdateRule handles PATCH /applications/rules/:id
func (h *AppControlHandler) UpdateRule(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var rule models.AppControlRule
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&rule).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Rule not found"})
		return
	}

	var in struct {
		Action       *string        `json:"action"`
		Enabled      *bool          `json:"enabled"`
		BlockNetwork *bool          `json:"block_network"`
		BlockProcess *bool          `json:"block_process"`
		Targets      map[string]any `json:"targets"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]any{}
	if in.Action != nil {
		action := strings.ToLower(strings.TrimSpace(*in.Action))
		if action != "alert" {
			action = "block"
		}
		updates["action"] = action
	}
	if in.Enabled != nil {
		updates["enabled"] = *in.Enabled
	}
	if in.BlockNetwork != nil {
		updates["block_network"] = *in.BlockNetwork
	}
	if in.BlockProcess != nil {
		updates["block_process"] = *in.BlockProcess
	}
	if in.Targets != nil {
		updates["targets"] = in.Targets
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Nothing to update"})
		return
	}

	if err := h.db.Model(&rule).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update the rule"})
		return
	}
	h.db.Preload("Application").First(&rule, "id = ?", rule.ID)
	c.JSON(http.StatusOK, rule)
}

// DeleteRule handles DELETE /applications/rules/:id
func (h *AppControlHandler) DeleteRule(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	res := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).Delete(&models.AppControlRule{})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove the rule"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Rule not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Application control removed"})
}

// CreateApplication handles POST /applications — an org-defined app, for
// software the built-in catalog doesn't cover.
func (h *AppControlHandler) CreateApplication(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var in struct {
		Name         string   `json:"name" binding:"required"`
		Vendor       string   `json:"vendor"`
		Category     string   `json:"category"`
		Description  string   `json:"description"`
		RiskLevel    int      `json:"risk_level"`
		ProcessNames []string `json:"process_names"`
		BundleIDs    []string `json:"bundle_ids"`
		PathPatterns []string `json:"path_patterns"`
		Domains      []string `json:"domains"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(in.ProcessNames) == 0 && len(in.Domains) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Give at least one process name or one domain — otherwise there is nothing to enforce",
		})
		return
	}

	category := strings.TrimSpace(in.Category)
	if category == "" {
		category = "other"
	}
	risk := in.RiskLevel
	if risk <= 0 || risk > 100 {
		risk = 50
	}

	app := models.ManagedApplication{
		OrgID:        &orgID,
		Name:         strings.TrimSpace(in.Name),
		Slug:         slugifyApp(in.Name),
		Vendor:       strings.TrimSpace(in.Vendor),
		Category:     category,
		Description:  strings.TrimSpace(in.Description),
		RiskLevel:    risk,
		ProcessNames: normalizeList(in.ProcessNames),
		BundleIDs:    normalizeList(in.BundleIDs),
		PathPatterns: normalizeList(in.PathPatterns),
		Domains:      normalizeList(in.Domains),
		Source:       "manual",
	}
	if err := h.db.Create(&app).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create the application"})
		return
	}
	c.JSON(http.StatusCreated, app)
}

// DeleteApplication handles DELETE /applications/:id — org-defined apps only;
// the built-in catalog is shared and not editable per tenant.
func (h *AppControlHandler) DeleteApplication(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var app models.ManagedApplication
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&app).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Application not found (built-in apps can't be deleted)"})
		return
	}
	h.db.Where("application_id = ?", app.ID).Delete(&models.AppControlRule{})
	if err := h.db.Delete(&app).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete the application"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Application deleted"})
}

// Events handles GET /applications/events — recent process-control activity.
func (h *AppControlHandler) Events(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var events []models.ActivityEvent
	h.db.Where("org_id = ? AND event_type = ?", orgID, models.EventTypeProcessStart).
		Order("timestamp DESC").Limit(100).Find(&events)
	attachEmployees(h.db, events)

	c.JSON(http.StatusOK, gin.H{"events": events, "total": len(events)})
}

// ─── Agent feed ──────────────────────────────────────────────────────────────

// GetAppControl handles GET /internal/agent/app-control — the process matchers
// this device should enforce. The network half is not here: it is merged into
// /internal/agent/rules so the agent's existing domain enforcement picks it up
// with no extra code path.
func (h *AgentHandler) GetAppControl(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	var teamID *uuid.UUID
	if empID != nil {
		var emp models.Employee
		if err := h.db.Select("team_id").Where("id = ?", *empID).First(&emp).Error; err == nil {
			teamID = emp.TeamID
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"applications": appControlMatchers(h.db, orgID, empID, teamID),
		// The watcher sleeps this long between sweeps. Long enough not to
		// matter on battery, short enough that a blocked app dies seconds
		// after launch.
		"poll_interval_sec": 15,
	})
}

// ReportAppBlock handles POST /internal/agent/app-block — the agent telling us
// it terminated (or observed) a controlled application.
func (h *AgentHandler) ReportAppBlock(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	var in struct {
		AppID       string `json:"app_id"`
		AppName     string `json:"app_name"`
		ProcessName string `json:"process_name"`
		PID         int    `json:"pid"`
		Path        string `json:"path"`
		Action      string `json:"action"` // blocked | alerted
		Terminated  bool   `json:"terminated"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	action := models.EventActionBlocked
	if in.Action == "alerted" || !in.Terminated {
		action = models.EventActionAlerted
	}

	event := models.ActivityEvent{
		OrgID:      orgID,
		EmployeeID: empID,
		DeviceID:   &deviceID,
		EventType:  models.EventTypeProcessStart,
		Action:     action,
		Target:     in.AppName,
		Operation:  OpAppLaunch,
		Category:   "application_control",
		PolicyName: "Application control: " + in.AppName,
		Metadata: map[string]any{
			"process_name": in.ProcessName,
			"pid":          in.PID,
			"path":         in.Path,
			"terminated":   in.Terminated,
			"app_id":       in.AppID,
		},
		Timestamp: time.Now(),
	}
	if err := h.db.Create(&event).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record the event"})
		return
	}

	events := []models.ActivityEvent{event}
	attachEmployees(h.db, events)
	h.hub.BroadcastActivityEvent(events[0])

	c.JSON(http.StatusOK, gin.H{"recorded": true})
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func boolOr(v *bool, fallback bool) bool {
	if v == nil {
		return fallback
	}
	return *v
}

func normalizeList(in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, s := range in {
		s = strings.ToLower(strings.TrimSpace(s))
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func slugifyApp(name string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}
