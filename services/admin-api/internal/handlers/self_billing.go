package handlers

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/razorpay"
	"github.com/aavishield/admin-api/internal/subscription"
)

// A paid company may pay for its next period this close to the end of the
// current one; earlier than that, plan changes go through the team.
const earlyRenewalWindow = 30 * 24 * time.Hour

// SelfServeBillingHandler lets a self-serve company see its plan and invoices
// and pay online (company console, /billing).
type SelfServeBillingHandler struct {
	db *gorm.DB
	rz *razorpay.Client
}

func NewSelfServeBillingHandler(db *gorm.DB) *SelfServeBillingHandler {
	return &SelfServeBillingHandler{db: db, rz: razorpay.New()}
}

func (h *SelfServeBillingHandler) org(c *gin.Context) (*models.Organization, bool) {
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

type checkoutRequest struct {
	Plan         string `json:"plan" binding:"required"`
	Seats        int    `json:"seats" binding:"required,min=1,max=10000"`
	BillingCycle string `json:"billing_cycle"`
}

func (h *SelfServeBillingHandler) quote(c *gin.Context) (subscription.Quote, bool) {
	var req checkoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return subscription.Quote{}, false
	}
	key, ok := subscription.PlanKey(req.Plan)
	if !ok {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Choose Essentials or Business. For Enterprise, talk to our team.", "code": "plan"})
		return subscription.Quote{}, false
	}
	plan, _ := subscription.LoadPlan(h.db, key)
	q, err := subscription.Compute(plan, subscription.Settings(h.db), req.Seats, req.BillingCycle, razorpay.Currency())
	if errors.Is(err, subscription.ErrSeats) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": "This plan covers " + seatRange(q) + " devices. For a larger fleet, talk to our team.",
			"code":  "seats", "min_seats": q.MinSeats, "max_seats": q.MaxSeats,
		})
		return q, false
	}
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "plan"})
		return q, false
	}
	return q, true
}

func seatRange(q subscription.Quote) string {
	if q.MaxSeats > 0 {
		return strconv.Itoa(q.MinSeats) + " to " + strconv.Itoa(q.MaxSeats)
	}
	return strconv.Itoa(q.MinSeats) + " or more"
}

// Get handles GET /billing — the plan, where the trial or paid period
// stands, and this company's invoices.
func (h *SelfServeBillingHandler) Get(c *gin.Context) {
	org, ok := h.org(c)
	if !ok {
		return
	}
	var records []models.BillingRecord
	h.db.Where("org_id = ?", org.ID).Order("created_at DESC").Limit(50).Find(&records)
	var pending *models.BillingRecord
	for i := range records {
		if records[i].Status == models.BillingStatusPending && subscription.IsSelfServe(&records[i]) {
			pending = &records[i]
			break
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"status":          org.Status,
		"plan":            org.Plan,
		"plan_interest":   org.PlanInterest,
		"self_serve":      org.SelfServe,
		"trial_ends_at":   org.TrialEndsAt,
		"paid_through":    org.PaidThrough,
		"expired":         org.Status == models.OrgStatusExpired,
		"expired_at":      org.ExpiredAt,
		"onboarding":      org.Onboarding,
		"online_payments": razorpay.Enabled(),
		"currency":        razorpay.Currency(),
		"pending":         pending,
		"invoices":        records,
	})
}

// Quote handles POST /billing/quote — the price for a plan, device count and
// cycle, with no side effects.
func (h *SelfServeBillingHandler) Quote(c *gin.Context) {
	if q, ok := h.quote(c); ok {
		c.JSON(http.StatusOK, q)
	}
}

// Checkout handles POST /billing/checkout — raises the invoice for the chosen
// plan and returns its Razorpay payment link. Asking again for the same plan
// returns the same unpaid invoice; asking for a different one replaces it.
func (h *SelfServeBillingHandler) Checkout(c *gin.Context) {
	org, ok := h.org(c)
	if !ok {
		return
	}
	if !org.SelfServe {
		c.JSON(http.StatusConflict, gin.H{"error": "Your plan is managed by the Aavishield team. Contact your account manager to change it.", "code": "sales_led"})
		return
	}
	now := time.Now()
	if org.Status == models.OrgStatusActive && org.PaidThrough != nil && org.PaidThrough.Sub(now) > earlyRenewalWindow {
		c.JSON(http.StatusConflict, gin.H{
			"error": "Your plan is paid through " + org.PaidThrough.Format("2 January 2006") + ". To change it before then, contact our team.",
			"code":  "already_paid",
		})
		return
	}
	q, ok := h.quote(c)
	if !ok {
		return
	}

	// Same request as an unpaid invoice from the last week: hand that back.
	var open []models.BillingRecord
	h.db.Where("org_id = ? AND status = ? AND source IN ?", org.ID, models.BillingStatusPending,
		[]string{models.BillingSourceCheckout, models.BillingSourceRenewal}).Find(&open)
	for i := range open {
		r := &open[i]
		if r.Plan == q.Plan && r.Seats == q.Seats && r.BillingCycle == q.Cycle && r.AmountPaise == q.Total &&
			now.Sub(r.CreatedAt) < 7*24*time.Hour && (r.ShortURL != "" || !razorpay.Enabled()) {
			c.JSON(http.StatusOK, gin.H{"invoice": r, "pay_url": r.ShortURL, "quote": q, "online_payments": razorpay.Enabled()})
			return
		}
	}
	// Otherwise the new choice replaces any older unpaid one.
	for i := range open {
		r := &open[i]
		if r.RazorpayPaymentLinkID != "" {
			_ = h.rz.CancelPaymentLink(r.RazorpayPaymentLinkID)
		}
		h.db.Model(r).Update("status", models.BillingStatusCancelled)
	}

	record, err := subscription.CreateInvoice(h.db, h.rz, org, q, now, models.BillingSourceCheckout, currentUserID(c))
	if err != nil {
		log.Printf("billing: checkout for org %s failed: %v", org.ID, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "We couldn't start the payment just now. Please try again in a minute."})
		return
	}
	writeAudit(h.db, c, &org.ID, "create", "billing_record", &record.ID, map[string]any{
		"source": record.Source, "plan": q.Plan, "seats": q.Seats, "billing_cycle": q.Cycle, "amount_minor": q.Total,
	})
	if record.ShortURL == "" {
		// Online payment isn't switched on: the team sends the link by hand.
		mailer.CheckoutAwaitingInvoice(teamRecipients(h.db, "LEADS_NOTIFY_EMAIL"), org.Name, q.PlanName, q.Seats, q.Cycle, q.Display)
	}
	c.JSON(http.StatusCreated, gin.H{"invoice": record, "pay_url": record.ShortURL, "quote": q, "online_payments": razorpay.Enabled()})
}

// applySelfServePayment runs when a self-serve invoice is reported paid: the
// org moves onto its plan, the console unlocks, and admins and the team hear
// about it. Safe to call more than once for the same record.
func applySelfServePayment(db *gorm.DB, record *models.BillingRecord) {
	if !subscription.IsSelfServe(record) {
		return
	}
	act, changed, err := subscription.Activate(db, record, time.Now())
	if err != nil {
		log.Printf("billing: activating org %s from record %s failed: %v", record.OrgID, record.ID, err)
		return
	}
	if !changed {
		return
	}
	middleware.ForgetOrgStatus(record.OrgID.String())
	amount := subscription.FormatMoney(record.AmountPaise, record.Currency)
	mailer.PlanActivated(subscription.AdminEmails(db, record.OrgID), act.Org.Name, act.PlanName, record.Seats, act.PaidThrough.Format("2 January 2006"))
	mailer.PaymentReceivedTeam(teamRecipients(db, "LEADS_NOTIFY_EMAIL"), act.Org.Name, act.PlanName, record.Seats, amount)
	db.Create(&models.AuditLog{OrgID: &record.OrgID, Action: "activate", Resource: "subscription", ResourceID: &record.ID,
		Changes: map[string]any{"plan": record.Plan, "seats": record.Seats, "paid_through": act.PaidThrough}})
}
