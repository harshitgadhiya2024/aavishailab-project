// Package subscription prices, invoices and activates self-serve plans.
//
// A self-serve company picks a plan, a device count and monthly or yearly
// billing in the console. That becomes a BillingRecord with a Razorpay Payment
// Link (the same mechanism superadmin invoices use); when Razorpay reports the
// link paid, Activate turns the company into a paying customer through the end
// of the period. The lifecycle job raises the renewal the same way a week
// before PaidThrough.
package subscription

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/razorpay"
)

const (
	CycleMonthly = "monthly"
	CycleAnnual  = "annual"
)

var (
	ErrPlan  = errors.New("choose Essentials or Business; for Enterprise, talk to our team")
	ErrSeats = errors.New("device count outside this plan's range")
)

// Settings is the pricing page's page-wide settings (GST, monthly uplift,
// pilot length), falling back to the defaults.
func Settings(db *gorm.DB) models.PricingSettings {
	s := models.DefaultPricingSettings
	var row models.PlatformSetting
	if err := db.Where("key = ?", models.PricingSettingsKey).First(&row).Error; err == nil {
		if raw, err := json.Marshal(row.Value); err == nil {
			_ = json.Unmarshal(raw, &s)
		}
	}
	return s
}

// PlanKey maps what the console sends ("essentials", "business", or the
// stored keys) to a plan key. Only self-serve plans are accepted.
func PlanKey(s string) (models.PlanType, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "essentials", string(models.PlanStarter):
		return models.PlanStarter, true
	case "business", string(models.PlanProfessional):
		return models.PlanProfessional, true
	}
	return "", false
}

// LoadPlan returns the plan as superadmin last edited it, or the default.
func LoadPlan(db *gorm.DB, key models.PlanType) (models.PricingPlan, bool) {
	var p models.PricingPlan
	if err := db.Where("key = ?", key).First(&p).Error; err == nil {
		return p, true
	}
	for _, d := range models.DefaultPricingPlans {
		if d.Key == key {
			return d, true
		}
	}
	return models.PricingPlan{}, false
}

// NormalizeCycle accepts "yearly"/"annual"/"monthly"; anything else is annual.
func NormalizeCycle(s string) string {
	if strings.ToLower(strings.TrimSpace(s)) == CycleMonthly {
		return CycleMonthly
	}
	return CycleAnnual
}

// Months is how long one billing period of the cycle lasts.
func Months(cycle string) int {
	if cycle == CycleMonthly {
		return 1
	}
	return 12
}

// Quote is the price of one billing period, in the currency's minor unit
// (paise or cents).
type Quote struct {
	Plan       models.PlanType `json:"plan"`
	PlanName   string          `json:"plan_name"`
	Seats      int             `json:"seats"`
	Cycle      string          `json:"billing_cycle"`
	Currency   string          `json:"currency"`
	UnitMinor  int64           `json:"unit_minor"` // per device per period
	Subtotal   int64           `json:"subtotal_minor"`
	TaxPercent float64         `json:"tax_percent"`
	Tax        int64           `json:"tax_minor"`
	Total      int64           `json:"total_minor"`
	MinSeats   int             `json:"min_seats"`
	MaxSeats   int             `json:"max_seats"`
	Display    string          `json:"total_display"`
}

// Compute prices seats devices of plan for one period. Prices are per device
// per year; monthly billing is a twelfth of that plus the monthly uplift, as
// on the website. GST applies to INR only.
func Compute(plan models.PricingPlan, s models.PricingSettings, seats int, cycle, currency string) (Quote, error) {
	if plan.Key != models.PlanStarter && plan.Key != models.PlanProfessional {
		return Quote{}, ErrPlan
	}
	q := Quote{Plan: plan.Key, PlanName: plan.Name, Seats: seats, Cycle: NormalizeCycle(cycle),
		Currency: strings.ToUpper(currency), MinSeats: plan.MinDevices, MaxSeats: plan.MaxDevices}
	if (plan.MinDevices > 0 && seats < plan.MinDevices) || (plan.MaxDevices > 0 && seats > plan.MaxDevices) || seats < 1 {
		return q, ErrSeats
	}
	annual := plan.PriceINR * 100
	if q.Currency == "USD" {
		annual = plan.PriceUSDCents
	} else {
		q.Currency = "INR"
		q.TaxPercent = s.GSTPercent
	}
	q.UnitMinor = annual
	if q.Cycle == CycleMonthly {
		q.UnitMinor = int64(math.Round(float64(annual) / 12 * (1 + s.MonthlyUpliftPct/100)))
	}
	q.Subtotal = q.UnitMinor * int64(seats)
	q.Tax = int64(math.Round(float64(q.Subtotal) * q.TaxPercent / 100))
	q.Total = q.Subtotal + q.Tax
	q.Display = FormatMoney(q.Total, q.Currency)
	return q, nil
}

// FormatMoney renders minor units as "₹21,227.64" (Indian grouping) or "$468.00".
func FormatMoney(minor int64, currency string) string {
	sym, indian := "$", false
	if strings.ToUpper(currency) != "USD" {
		sym, indian = "₹", true
	}
	whole, frac := minor/100, minor%100
	digits := fmt.Sprint(whole)
	var out string
	if len(digits) <= 3 {
		out = digits
	} else {
		out = digits[len(digits)-3:]
		rest := digits[:len(digits)-3]
		group := 3
		if indian {
			group = 2
		}
		for len(rest) > group {
			out = rest[len(rest)-group:] + "," + out
			rest = rest[:len(rest)-group]
		}
		out = rest + "," + out
	}
	return fmt.Sprintf("%s%s.%02d", sym, out, frac)
}

// AdminEmails is who hears about trial and billing changes: active org admins.
func AdminEmails(db *gorm.DB, orgID uuid.UUID) []string {
	var emails []string
	db.Model(&models.User{}).
		Where("org_id = ? AND status = ? AND role = ?", orgID, models.StatusActive, models.RoleOrgAdmin).
		Pluck("email", &emails)
	return emails
}

// CreateInvoice records one period of q for org and, when Razorpay is set up,
// a payment link for it. Without Razorpay the record is still saved (pending,
// no link) so the team can collect payment by hand.
func CreateInvoice(db *gorm.DB, rz *razorpay.Client, org *models.Organization, q Quote, periodStart time.Time, source string, createdBy *uuid.UUID) (*models.BillingRecord, error) {
	end := periodStart.AddDate(0, Months(q.Cycle), 0)
	desc := fmt.Sprintf("Aavishield %s, %d devices, %s", q.PlanName, q.Seats, q.Cycle)
	record := models.BillingRecord{
		Base:         models.Base{ID: uuid.New()},
		OrgID:        org.ID,
		Plan:         q.Plan,
		AmountPaise:  q.Total,
		Currency:     q.Currency,
		BillingCycle: q.Cycle,
		Status:       models.BillingStatusPending,
		Description:  desc,
		Source:       source,
		Seats:        q.Seats,
		PeriodStart:  &periodStart,
		PeriodEnd:    &end,
		CreatedBy:    createdBy,
	}
	if razorpay.Enabled() && rz != nil {
		email := org.BillingEmail
		if email == "" {
			email = org.ContactEmail
		}
		if email == "" {
			if admins := AdminEmails(db, org.ID); len(admins) > 0 {
				email = admins[0]
			}
		}
		link, err := rz.CreatePaymentLink(q.Total, desc, record.ID.String(),
			razorpay.PaymentLinkCustomer{Name: org.Name, Email: email},
			map[string]string{"org_id": org.ID.String(), "org_name": org.Name, "source": source, "seats": fmt.Sprint(q.Seats), "plan": string(q.Plan)})
		if err != nil {
			return nil, fmt.Errorf("razorpay: %w", err)
		}
		record.RazorpayPaymentLinkID = link.ID
		record.ShortURL = link.ShortURL
	}
	if err := db.Create(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

// IsSelfServe reports whether a billing record was raised by the self-serve flow.
func IsSelfServe(r *models.BillingRecord) bool {
	return r.Source == models.BillingSourceCheckout || r.Source == models.BillingSourceRenewal
}

// Activation is what Activate changed, for the confirmation emails.
type Activation struct {
	Org         models.Organization
	PlanName    string
	PaidThrough time.Time
}

// Activate applies a paid self-serve record: the org becomes active on the
// record's plan through the end of the paid period. The period starts when
// the earlier paid period ends, or now if that has passed (a lapsed or
// first-time payment), so nobody pays for days they couldn't use.
// Idempotent per record: a record already applied (marked in the org's
// settings) changes nothing and returns ok=false.
func Activate(db *gorm.DB, record *models.BillingRecord, now time.Time) (Activation, bool, error) {
	var org models.Organization
	if err := db.First(&org, "id = ?", record.OrgID).Error; err != nil {
		return Activation{}, false, err
	}
	applied := "billing_applied_" + record.ID.String()
	if org.Settings != nil && org.Settings[applied] != nil {
		return Activation{}, false, nil
	}

	start := now
	if org.PaidThrough != nil && org.PaidThrough.After(now) {
		start = *org.PaidThrough
	}
	end := start.AddDate(0, Months(record.BillingCycle), 0)

	if org.Settings == nil {
		org.Settings = map[string]any{}
	}
	org.Settings[applied] = now.Format(time.RFC3339)
	onboarding := org.Onboarding
	if onboarding == nil {
		onboarding = map[string]any{}
	}
	onboarding["seats"] = record.Seats
	onboarding["billing_cycle"] = record.BillingCycle

	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&org).Updates(map[string]any{
			"status":        models.OrgStatusActive,
			"plan":          record.Plan,
			"plan_interest": string(record.Plan),
			"paid_through":  end,
			"expired_at":    nil,
			"settings":      org.Settings,
			"onboarding":    onboarding,
		}).Error; err != nil {
			return err
		}
		return tx.Model(record).Updates(map[string]any{"period_start": start, "period_end": end}).Error
	})
	if err != nil {
		return Activation{}, false, err
	}
	org.Status, org.Plan, org.PaidThrough = models.OrgStatusActive, record.Plan, &end
	name := string(record.Plan)
	if p, ok := LoadPlan(db, record.Plan); ok {
		name = p.Name
	}
	return Activation{Org: org, PlanName: name, PaidThrough: end}, true, nil
}
