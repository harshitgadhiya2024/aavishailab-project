package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PricingHandler serves the marketing website's pricing plans. Superadmins
// edit them in the panel; the website reads them through /public/pricing.
type PricingHandler struct {
	db *gorm.DB
}

func NewPricingHandler(db *gorm.DB) *PricingHandler {
	return &PricingHandler{db: db}
}

func (h *PricingHandler) plans() []models.PricingPlan {
	var plans []models.PricingPlan
	h.db.Order("sort_order ASC, price_inr ASC").Find(&plans)
	return plans
}

func (h *PricingHandler) settings() models.PricingSettings {
	return pricingSettings(h.db)
}

// pricingSettings reads the saved pricing settings over the defaults, so a
// field added later still has a value on an old row. The free pilot here is
// also the self-serve trial: its length and device count.
func pricingSettings(db *gorm.DB) models.PricingSettings {
	s := models.DefaultPricingSettings
	var row models.PlatformSetting
	if err := db.Where("key = ?", models.PricingSettingsKey).First(&row).Error; err == nil {
		if raw, err := json.Marshal(row.Value); err == nil {
			_ = json.Unmarshal(raw, &s)
		}
	}
	return s
}

// trialDays is how long a self-serve trial runs: the pilot length set on the
// pricing page, or 14 days when the pilot offer is switched off.
func trialDays(db *gorm.DB) int {
	if d := pricingSettings(db).PilotDays; d > 0 {
		return d
	}
	return 14
}

// trialTeamDevices is how many devices a self-serve team trial covers.
func trialTeamDevices(db *gorm.DB) int {
	if n := pricingSettings(db).PilotDevices; n > 0 {
		return n
	}
	return 10
}

// ─── Public (website) ───────────────────────────────────────────────────────

// Public handles GET /public/pricing — every plan and the page-wide rules.
func (h *PricingHandler) Public(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=60")
	c.JSON(http.StatusOK, gin.H{"plans": h.plans(), "settings": h.settings()})
}

// ─── Superadmin ─────────────────────────────────────────────────────────────

// Get handles GET /superadmin/pricing — the same data, for the editor.
func (h *PricingHandler) Get(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"plans": h.plans(), "settings": h.settings()})
}

type pricingPlanRequest struct {
	Name          string   `json:"name" binding:"required,max=60"`
	Tagline       string   `json:"tagline" binding:"max=200"`
	Features      []string `json:"features" binding:"max=20"`
	PriceINR      int64    `json:"price_inr" binding:"gt=0,lt=10000000"`
	PriceUSDCents int64    `json:"price_usd_cents" binding:"gt=0,lt=100000000"`
	MinDevices    int      `json:"min_devices" binding:"gte=1,lte=100000"`
	MaxDevices    int      `json:"max_devices" binding:"gte=0,lte=100000"`
	Popular       bool     `json:"popular"`
	StartsAt      bool     `json:"starts_at"`
	SortOrder     int      `json:"sort_order"`
}

// UpdatePlan handles PUT /superadmin/pricing/plans/:key — edits one plan.
// Only one plan can be "Most popular", so setting it clears the others.
func (h *PricingHandler) UpdatePlan(c *gin.Context) {
	var plan models.PricingPlan
	if err := h.db.Where("key = ?", c.Param("key")).First(&plan).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Plan not found"})
		return
	}
	var req pricingPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.MaxDevices != 0 && req.MaxDevices < req.MinDevices {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Maximum devices must be 0 (no limit) or at least the minimum"})
		return
	}
	features := make([]string, 0, len(req.Features))
	for _, f := range req.Features {
		if f = strings.TrimSpace(f); f != "" {
			features = append(features, clip(f, 120))
		}
	}

	before := plan
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if req.Popular {
			if err := tx.Model(&models.PricingPlan{}).Where("id <> ?", plan.ID).Update("popular", false).Error; err != nil {
				return err
			}
		}
		return tx.Model(&plan).Select("*").Omit("id", "key", "created_at", "deleted_at").Updates(models.PricingPlan{
			Name: strings.TrimSpace(req.Name), Tagline: strings.TrimSpace(req.Tagline), Features: features,
			PriceINR: req.PriceINR, PriceUSDCents: req.PriceUSDCents,
			MinDevices: req.MinDevices, MaxDevices: req.MaxDevices,
			Popular: req.Popular, StartsAt: req.StartsAt, SortOrder: req.SortOrder,
		}).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save plan"})
		return
	}

	writeAudit(h.db, c, nil, "update", "pricing_plan", &plan.ID, map[string]any{
		"key":             string(plan.Key),
		"price_inr":       []int64{before.PriceINR, req.PriceINR},
		"price_usd_cents": []int64{before.PriceUSDCents, req.PriceUSDCents},
		"min_devices":     []int{before.MinDevices, req.MinDevices},
		"max_devices":     []int{before.MaxDevices, req.MaxDevices},
	})
	h.db.First(&plan, "id = ?", plan.ID)
	c.JSON(http.StatusOK, plan)
}

type pricingSettingsRequest struct {
	GSTPercent       float64 `json:"gst_percent" binding:"gte=0,lte=50"`
	MonthlyUpliftPct float64 `json:"monthly_uplift_percent" binding:"gte=0,lte=200"`
	PilotDays        int     `json:"pilot_days" binding:"gte=0,lte=365"`
	PilotDevices     int     `json:"pilot_devices" binding:"gte=0,lte=10000"`
	VolumeFrom       int     `json:"volume_from" binding:"gte=0,lte=1000000"`
}

// UpdateSettings handles PUT /superadmin/pricing/settings — GST, monthly
// billing surcharge, free pilot and the volume-pricing threshold.
func (h *PricingHandler) UpdateSettings(c *gin.Context) {
	var req pricingSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	s := models.PricingSettings(req)
	raw, _ := json.Marshal(s)
	var value map[string]any
	_ = json.Unmarshal(raw, &value)

	uid := currentUserID(c)
	var row models.PlatformSetting
	var err error
	if h.db.Where("key = ?", models.PricingSettingsKey).First(&row).Error == nil {
		err = h.db.Model(&row).Updates(map[string]any{"value": value, "updated_by": uid}).Error
	} else {
		err = h.db.Create(&models.PlatformSetting{Key: models.PricingSettingsKey, Value: value, UpdatedBy: uid}).Error
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save pricing settings"})
		return
	}
	writeAudit(h.db, c, nil, "update", "pricing_settings", nil, value)
	c.JSON(http.StatusOK, h.settings())
}
