package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// A new self-serve company starts on the admin's own laptop; choosing a plan
// opens the trial to the team, up to the pilot device count on the pricing
// page (trialTeamDevices).
const selfServeSoloDevices = 1

// starterPolicyName marks the web policy the onboarding wizard creates, so
// running the step again updates it instead of adding a second one.
const starterPolicyName = "Starter web policy"

// Categories the wizard may block; a subset of domain_categories.json.
var starterCategories = map[string]bool{
	"ai_tools": true, "social_media": true, "gambling": true, "adult_content": true, "streaming": true,
	"gaming": true, "torrent": true, "vpn_proxy": true, "webmail_personal_email": true, "cloud_storage": true,
	"dating": true, "shopping": true, "job_search": true,
}

// OnboardingHandler drives the first-run wizard for self-serve companies.
type OnboardingHandler struct {
	db *gorm.DB
}

func NewOnboardingHandler(db *gorm.DB) *OnboardingHandler {
	return &OnboardingHandler{db: db}
}

func (h *OnboardingHandler) org(c *gin.Context) (*models.Organization, bool) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No organization in scope"})
		return nil, false
	}
	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return nil, false
	}
	return &org, true
}

// Get handles GET /onboarding — where the wizard stands and what is set up.
func (h *OnboardingHandler) Get(c *gin.Context) {
	org, ok := h.org(c)
	if !ok {
		return
	}
	var devices, onlineDevices, policies int64
	h.db.Model(&models.Device{}).Where("org_id = ?", org.ID).Count(&devices)
	h.db.Model(&models.Device{}).Where("org_id = ? AND status = ?", org.ID, "online").Count(&onlineDevices)
	h.db.Model(&models.Policy{}).Where("org_id = ? AND enabled = ?", org.ID, true).Count(&policies)

	var starter models.Policy
	starterCats := []string{}
	if h.db.Where("org_id = ? AND name = ?", org.ID, starterPolicyName).First(&starter).Error == nil {
		if list, ok := starter.Rules["categories"].([]any); ok {
			for _, v := range list {
				if s, ok := v.(string); ok {
					starterCats = append(starterCats, s)
				}
			}
		}
	}

	answers := org.Onboarding
	if answers == nil {
		answers = map[string]any{}
	}
	var demoBookings int64
	h.db.Model(&models.DemoRequest{}).Where("org_id = ? AND preferred_at IS NOT NULL AND cancelled_at IS NULL", org.ID).Count(&demoBookings)
	c.JSON(http.StatusOK, gin.H{
		"prompts":            userPrompts(h.db, c),
		"demo_booked":        demoBookings > 0,
		"self_serve":         org.SelfServe,
		"onboarded":          org.OnboardedAt != nil,
		"org_name":           org.Name,
		"org_slug":           org.Slug,
		"plan_interest":      org.PlanInterest,
		"trial_ends_at":      org.TrialEndsAt,
		"trial_device_limit": org.TrialDeviceLimit,
		"trial_days":         trialDays(h.db),
		"team_devices":       trialTeamDevices(h.db),
		"team_trial":         org.TeamTrialAt != nil,
		"status":             org.Status,
		"expired":            org.Status == models.OrgStatusExpired,
		"paid_through":       org.PaidThrough,
		"answers":            answers,
		"starter_categories": starterCats,
		"progress": gin.H{
			"policies":       policies,
			"devices":        devices,
			"online_devices": onlineDevices,
		},
	})
}

// SaveAnswers handles PUT /onboarding/answers — the "a couple of questions" step.
func (h *OnboardingHandler) SaveAnswers(c *gin.Context) {
	org, ok := h.org(c)
	if !ok {
		return
	}
	var req struct {
		TeamSize  string   `json:"team_size" binding:"max=40"`
		Goals     []string `json:"goals" binding:"max=10"`
		HeardFrom string   `json:"heard_from" binding:"max=60"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	answers := org.Onboarding
	if answers == nil {
		answers = map[string]any{}
	}
	answers["team_size"] = strings.TrimSpace(req.TeamSize)
	answers["goals"] = req.Goals
	answers["heard_from"] = strings.TrimSpace(req.HeardFrom)
	updates := map[string]any{"onboarding": answers}
	if req.TeamSize != "" {
		updates["company_size"] = strings.TrimSpace(req.TeamSize)
	}
	if err := h.db.Model(org).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save your answers"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"saved": true})
}

// StarterPolicy handles POST /onboarding/starter-policy — one web policy that
// blocks the chosen categories for everyone. Running it again updates it.
func (h *OnboardingHandler) StarterPolicy(c *gin.Context) {
	org, ok := h.org(c)
	if !ok {
		return
	}
	var req struct {
		Categories []string `json:"categories" binding:"max=20"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cats := []any{}
	seen := map[string]bool{}
	for _, s := range req.Categories {
		s = strings.TrimSpace(s)
		if starterCategories[s] && !seen[s] {
			seen[s] = true
			cats = append(cats, s)
		}
	}

	uid := currentUserID(c)
	var policy models.Policy
	exists := h.db.Where("org_id = ? AND name = ?", org.ID, starterPolicyName).First(&policy).Error == nil
	policy.OrgID = org.ID
	policy.Name = starterPolicyName
	policy.Description = "Created during setup. Edit it any time under Web Gateway."
	policy.Type = models.PolicyTypeURLCategory
	policy.Action = models.PolicyActionBlock
	policy.Priority = 100
	policy.Enabled = len(cats) > 0
	policy.Rules = map[string]any{"categories": cats}
	policy.Targets = map[string]any{"scope": "all"}
	policy.UpdatedBy = uid
	if !exists {
		policy.CreatedBy = uid
	} else {
		policy.Version++
	}
	policy.RegoBundle = generateRegoBundle(&policy)

	if err := h.db.Save(&policy).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save the policy"})
		return
	}
	action := "create"
	if exists {
		action = "update"
	}
	writeAudit(h.db, c, &org.ID, action, "policy", &policy.ID, map[string]any{"categories": cats, "source": "onboarding"})
	c.JSON(http.StatusOK, policy)
}

// TeamTrial handles POST /onboarding/team-trial — the admin picks a plan and
// team size, which opens the trial beyond their own laptop.
func (h *OnboardingHandler) TeamTrial(c *gin.Context) {
	org, ok := h.org(c)
	if !ok {
		return
	}
	var req struct {
		Plan         string `json:"plan" binding:"required"`
		Seats        int    `json:"seats" binding:"required,min=1,max=250"`
		BillingCycle string `json:"billing_cycle"` // monthly or yearly
		Currency     string `json:"currency"`      // INR or USD, from the visitor's country
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	plan := strings.ToLower(req.Plan)
	if plan != "essentials" && plan != "business" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Choose Essentials or Business. For Enterprise, talk to our team."})
		return
	}
	if !org.SelfServe || org.Status != models.OrgStatusTrial {
		c.JSON(http.StatusConflict, gin.H{"error": "This organization is not on a self-serve trial."})
		return
	}

	now := time.Now()
	answers := org.Onboarding
	if answers == nil {
		answers = map[string]any{}
	}
	answers["seats"] = req.Seats
	answers["billing_cycle"] = "yearly"
	if strings.ToLower(req.BillingCycle) == "monthly" {
		answers["billing_cycle"] = "monthly"
	}
	if c := strings.ToUpper(req.Currency); c == "INR" || c == "USD" {
		answers["currency"] = c
	}
	limit := req.Seats
	if team := trialTeamDevices(h.db); limit > team {
		limit = team
	}
	if limit < selfServeSoloDevices {
		limit = selfServeSoloDevices
	}
	updates := map[string]any{
		"plan_interest":      plan,
		"trial_device_limit": limit,
		"onboarding":         answers,
	}
	if org.TeamTrialAt == nil {
		updates["team_trial_at"] = now
	}
	if err := h.db.Model(org).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not start the team trial"})
		return
	}
	writeAudit(h.db, c, &org.ID, "update", "organization", &org.ID, map[string]any{"team_trial": true, "plan": plan, "seats": req.Seats, "billing_cycle": answers["billing_cycle"]})
	c.JSON(http.StatusOK, gin.H{"team_trial": true, "trial_device_limit": limit, "trial_ends_at": org.TrialEndsAt})
}

// Console prompts a user answers once: the first-login welcome, the product
// tour invitation and the book-a-demo invitation. Kept per user, server side,
// so a dismissed prompt stays dismissed on every browser.
var consolePrompts = map[string]bool{"welcome": true, "tour": true, "demo": true}

func userPrompts(db *gorm.DB, c *gin.Context) map[string]any {
	out := map[string]any{}
	uid := currentUserID(c)
	if uid == nil {
		return out
	}
	var u models.User
	if db.Select("id", "settings").First(&u, "id = ?", *uid).Error != nil || u.Settings == nil {
		return out
	}
	if p, ok := u.Settings["prompts"].(map[string]any); ok {
		return p
	}
	return out
}

// SetPrompt handles PUT /me/prompts — records how the user answered one of
// the console prompts. state is "seen", "dismissed" or "done"; any of them
// stops the prompt appearing again.
func (h *OnboardingHandler) SetPrompt(c *gin.Context) {
	var req struct {
		Prompt string `json:"prompt" binding:"required"`
		State  string `json:"state" binding:"required,oneof=seen dismissed done"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !consolePrompts[req.Prompt] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown prompt"})
		return
	}
	uid := currentUserID(c)
	var u models.User
	if uid == nil || h.db.First(&u, "id = ?", *uid).Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Sign in again"})
		return
	}
	if u.Settings == nil {
		u.Settings = map[string]any{}
	}
	prompts, _ := u.Settings["prompts"].(map[string]any)
	if prompts == nil {
		prompts = map[string]any{}
	}
	prompts[req.Prompt] = map[string]any{"state": req.State, "at": time.Now().UTC().Format(time.RFC3339)}
	u.Settings["prompts"] = prompts
	if err := h.db.Model(&u).Update("settings", u.Settings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"prompts": prompts})
}

// Complete handles POST /onboarding/complete.
func (h *OnboardingHandler) Complete(c *gin.Context) {
	org, ok := h.org(c)
	if !ok {
		return
	}
	if org.OnboardedAt == nil {
		now := time.Now()
		h.db.Model(org).Update("onboarded_at", now)
	}
	c.JSON(http.StatusOK, gin.H{"onboarded": true})
}

// trialDeviceLimitReached reports whether a self-serve trial org already has
// as many devices as its trial allows. Paid and sales-led orgs are never capped.
func trialDeviceLimitReached(db *gorm.DB, orgID uuid.UUID) (bool, int) {
	var org models.Organization
	if err := db.Select("id", "self_serve", "status", "trial_device_limit").First(&org, "id = ?", orgID).Error; err != nil {
		return false, 0
	}
	if !org.SelfServe || org.Status != models.OrgStatusTrial || org.TrialDeviceLimit <= 0 {
		return false, 0
	}
	var n int64
	db.Model(&models.Device{}).Where("org_id = ?", orgID).Count(&n)
	return n >= int64(org.TrialDeviceLimit), org.TrialDeviceLimit
}

// screenshotsLockedForTrial reports whether activity screenshots must stay off:
// self-serve trials can't record screens until the company is on a paid plan,
// and neither can a company whose trial or subscription has ended.
func screenshotsLockedForTrial(db *gorm.DB, orgID uuid.UUID) bool {
	var org models.Organization
	if err := db.Select("id", "self_serve", "status").First(&org, "id = ?", orgID).Error; err != nil {
		return false
	}
	return org.SelfServe && (org.Status == models.OrgStatusTrial || org.Status == models.OrgStatusExpired)
}

// orgExpired reports whether the org's trial or paid period has ended.
func orgExpired(db *gorm.DB, orgID uuid.UUID) bool {
	var org models.Organization
	if err := db.Select("id", "status").First(&org, "id = ?", orgID).Error; err != nil {
		return false
	}
	return org.Status == models.OrgStatusExpired
}
