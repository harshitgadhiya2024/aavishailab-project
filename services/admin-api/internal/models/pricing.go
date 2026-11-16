package models

// ─── Pricing plans ──────────────────────────────────────────────────────────
// The plans shown on the marketing website's pricing page, edited by
// superadmins in the panel. There is one row per paid PlanType (starter,
// professional, enterprise), so the price a visitor sees and the plan an
// organization is billed for are the same thing. Rows are seeded once and
// never created or deleted from the panel, only edited.

type PricingPlan struct {
	Base
	// Key is the organization plan this row prices: starter, professional or enterprise.
	Key  PlanType `gorm:"type:varchar(32);uniqueIndex;not null" json:"key"`
	Name string   `gorm:"not null" json:"name"`
	// Tagline is the one-line "who it is for" under the plan name.
	Tagline  string   `json:"tagline"`
	Features []string `gorm:"type:jsonb;serializer:json" json:"features"`

	// Prices are per device per year, before tax. INR in whole rupees, USD in
	// cents, so no float money anywhere (as with BillingRecord.AmountPaise).
	PriceINR      int64 `gorm:"not null" json:"price_inr"`
	PriceUSDCents int64 `gorm:"not null" json:"price_usd_cents"`

	// Device range this plan is sold for. MaxDevices 0 means no upper limit.
	MinDevices int `gorm:"not null;default:1" json:"min_devices"`
	MaxDevices int `gorm:"not null;default:0" json:"max_devices"`

	// Popular puts the "Most popular" tag on the card. StartsAt shows the
	// price as "From ₹…", for plans that are finalised in a quote.
	Popular   bool `gorm:"not null;default:false" json:"popular"`
	StartsAt  bool `gorm:"not null;default:false" json:"starts_at"`
	SortOrder int  `gorm:"not null;default:0" json:"sort_order"`
}

// PricingSettings are the page-wide rules around the plans. They live in
// PlatformSetting under PricingSettingsKey rather than in their own table.
type PricingSettings struct {
	GSTPercent       float64 `json:"gst_percent"`
	MonthlyUpliftPct float64 `json:"monthly_uplift_percent"`
	PilotDays        int     `json:"pilot_days"`
	PilotDevices     int     `json:"pilot_devices"`
	VolumeFrom       int     `json:"volume_from"`
}

const PricingSettingsKey = "pricing"

// DefaultPricingSettings is what the website shows before a superadmin has
// ever saved the pricing settings.
var DefaultPricingSettings = PricingSettings{
	GSTPercent:       18,
	MonthlyUpliftPct: 20,
	PilotDays:        14,
	PilotDevices:     10,
	VolumeFrom:       100,
}

// DefaultPricingPlans are the launch prices, inserted on first boot.
var DefaultPricingPlans = []PricingPlan{
	{
		Key: PlanStarter, Name: "Essentials", Tagline: "For small teams getting their first policy in place.",
		Features:   []string{"Web Gateway", "VPN Control", "Malware Scanning", "Device Posture", "Admin console"},
		PriceINR:   1799, PriceUSDCents: 3900, MinDevices: 10, MaxDevices: 50, SortOrder: 1,
	},
	{
		Key: PlanProfessional, Name: "Business", Tagline: "For companies that handle customer or financial data.",
		Features:   []string{"Everything in Essentials", "Data Loss Prevention", "Application Control", "AI classification of files", "Per-group policies"},
		PriceINR:   3599, PriceUSDCents: 7900, MinDevices: 10, MaxDevices: 50, Popular: true, SortOrder: 2,
	},
	{
		Key: PlanEnterprise, Name: "Enterprise", Tagline: "For fleets of more than 50 devices, with audit and monitoring needs.",
		Features:   []string{"Everything in Business", "Activity Monitoring", "Custom data retention", "Dedicated onboarding", "Priority support"},
		PriceINR:   5499, PriceUSDCents: 11900, MinDevices: 51, StartsAt: true, SortOrder: 3,
	},
}
