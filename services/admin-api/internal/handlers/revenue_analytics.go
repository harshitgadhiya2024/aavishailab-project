package handlers

import (
	"net/http"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RevenueAnalyticsHandler computes real numbers from BillingRecord — there
// is no synthetic or placeholder revenue data anywhere here; every figure
// is zero until a real Razorpay-backed invoice is created and paid, and
// grows only as that actually happens.
type RevenueAnalyticsHandler struct {
	db *gorm.DB
}

func NewRevenueAnalyticsHandler(db *gorm.DB) *RevenueAnalyticsHandler {
	return &RevenueAnalyticsHandler{db: db}
}

type orgMRRRow struct {
	OrgID        string `json:"-"`
	AmountPaise  int64  `json:"-"`
	BillingCycle string `json:"-"`
}

// Get handles GET /superadmin/revenue-analytics
func (h *RevenueAnalyticsHandler) Get(c *gin.Context) {
	var totalPaisePaid, totalPaisePending int64
	h.db.Model(&models.BillingRecord{}).Where("status = ?", models.BillingStatusPaid).
		Select("COALESCE(SUM(amount_paise), 0)").Scan(&totalPaisePaid)
	h.db.Model(&models.BillingRecord{}).Where("status = ?", models.BillingStatusPending).
		Select("COALESCE(SUM(amount_paise), 0)").Scan(&totalPaisePending)

	// MRR estimate: each org's single most recent PAID record, normalized to
	// a monthly figure (annual / 12; one-time contributes nothing recurring).
	// A raw SQL DISTINCT ON keeps this to one query instead of N.
	var rows []orgMRRRow
	h.db.Raw(`
		SELECT DISTINCT ON (org_id) org_id, amount_paise, billing_cycle
		FROM billing_records
		WHERE status = ? AND deleted_at IS NULL
		ORDER BY org_id, paid_at DESC
	`, models.BillingStatusPaid).Scan(&rows)

	var mrrPaise int64
	for _, r := range rows {
		switch r.BillingCycle {
		case "monthly":
			mrrPaise += r.AmountPaise
		case "annual":
			mrrPaise += r.AmountPaise / 12
		}
	}

	type monthRevenue struct {
		Month       string `json:"month"`
		AmountPaise int64  `json:"amount_paise"`
	}
	var trend []monthRevenue
	h.db.Raw(`
		SELECT to_char(paid_at, 'YYYY-MM') as month, SUM(amount_paise) as amount_paise
		FROM billing_records
		WHERE status = ? AND paid_at IS NOT NULL AND deleted_at IS NULL
		GROUP BY month ORDER BY month ASC
	`, models.BillingStatusPaid).Scan(&trend)

	var totalOrgsWithBilling int64
	h.db.Model(&models.BillingRecord{}).Distinct("org_id").Count(&totalOrgsWithBilling)

	var overdueCount int64
	h.db.Model(&models.BillingRecord{}).Where("status = ? AND period_end < now()", models.BillingStatusPending).Count(&overdueCount)

	c.JSON(http.StatusOK, gin.H{
		"mrr_paise":             mrrPaise,
		"total_collected_paise": totalPaisePaid,
		"total_pending_paise":   totalPaisePending,
		"overdue_invoices":      overdueCount,
		"orgs_with_billing":     totalOrgsWithBilling,
		"monthly_revenue_trend": trend,
		"currency":              "INR",
	})
}
