package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/razorpay"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BillingHandler manages invoices raised against an org, paid through a
// Razorpay Payment Link — superadmin creates the charge, the org's finance
// contact pays it on Razorpay's own hosted page, and this handler (plus the
// webhook in billing_webhook.go) tracks the record from pending to paid.
type BillingHandler struct {
	db *gorm.DB
	rz *razorpay.Client
}

func NewBillingHandler(db *gorm.DB) *BillingHandler {
	return &BillingHandler{db: db, rz: razorpay.New()}
}

type createBillingRequest struct {
	// AmountRupees, not paise — the superadmin UI works in whole rupees;
	// converting here keeps that unit boundary in exactly one place.
	AmountRupees float64 `json:"amount_rupees" binding:"required,gt=0"`
	Plan         string  `json:"plan"`
	BillingCycle string  `json:"billing_cycle"`
	Description  string  `json:"description" binding:"required"`
	PeriodStart  *string `json:"period_start"`
	PeriodEnd    *string `json:"period_end"`
}

// Create handles POST /superadmin/organizations/:id/billing — raises a new
// invoice and, if Razorpay is configured, a real payment link for it.
func (h *BillingHandler) Create(c *gin.Context) {
	orgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad organization id"})
		return
	}
	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	var req createBillingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cycle := req.BillingCycle
	if cycle != "monthly" && cycle != "annual" && cycle != "one_time" {
		cycle = "one_time"
	}
	plan := models.PlanType(req.Plan)
	if plan == "" {
		plan = org.Plan
	}

	record := models.BillingRecord{
		OrgID:        orgID,
		Plan:         plan,
		AmountPaise:  int64(req.AmountRupees * 100),
		Currency:     razorpay.Currency(),
		BillingCycle: cycle,
		Status:       models.BillingStatusPending,
		Description:  req.Description,
		PeriodStart:  parseOptionalDate(req.PeriodStart),
		PeriodEnd:    parseOptionalDate(req.PeriodEnd),
		CreatedBy:    currentUserID(c),
	}

	if razorpay.Enabled() {
		customer := razorpay.PaymentLinkCustomer{Name: org.Name, Email: org.BillingEmail}
		if customer.Email == "" {
			customer.Email = org.ContactEmail
		}
		link, err := h.rz.CreatePaymentLink(record.AmountPaise, req.Description, "", customer, map[string]string{
			"org_id":   orgID.String(),
			"org_name": org.Name,
		})
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "Could not create Razorpay payment link: " + err.Error()})
			return
		}
		record.RazorpayPaymentLinkID = link.ID
		record.ShortURL = link.ShortURL
	}

	if err := h.db.Create(&record).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save billing record"})
		return
	}

	writeAudit(h.db, c, &orgID, "create", "billing_record", &record.ID, map[string]any{
		"amount_paise": record.AmountPaise, "description": req.Description,
	})

	c.JSON(http.StatusCreated, record)
}

func parseOptionalDate(s *string) *time.Time {
	if s == nil || *s == "" {
		return nil
	}
	t, err := time.Parse("2006-01-02", *s)
	if err != nil {
		return nil
	}
	return &t
}

// ListForOrg handles GET /superadmin/organizations/:id/billing
func (h *BillingHandler) ListForOrg(c *gin.Context) {
	orgID := c.Param("id")
	var records []models.BillingRecord
	h.db.Where("org_id = ?", orgID).Order("created_at DESC").Find(&records)
	c.JSON(http.StatusOK, gin.H{"records": records, "total": len(records)})
}

// List handles GET /superadmin/billing — every org, for the platform-wide
// billing overview and revenue analytics.
func (h *BillingHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := h.db.Model(&models.BillingRecord{})
	if status := c.Query("status"); status != "" {
		q = q.Where("status = ?", status)
	}
	var total int64
	q.Count(&total)

	var records []models.BillingRecord
	q.Preload("Org").Order("created_at DESC").Offset((page - 1) * limit).Limit(limit).Find(&records)

	c.JSON(http.StatusOK, gin.H{
		"records": records, "total": total, "page": page, "limit": limit,
		"pages": (total + int64(limit) - 1) / int64(limit),
	})
}

// Refresh handles POST /superadmin/billing/:id/refresh — manual fallback for
// when a webhook was missed: polls Razorpay directly for current status.
func (h *BillingHandler) Refresh(c *gin.Context) {
	var record models.BillingRecord
	if err := h.db.First(&record, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Billing record not found"})
		return
	}
	if record.RazorpayPaymentLinkID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This record has no Razorpay payment link to check"})
		return
	}
	link, err := h.rz.GetPaymentLink(record.RazorpayPaymentLinkID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Could not reach Razorpay: " + err.Error()})
		return
	}
	applyPaymentLinkStatus(h.db, &record, link.Status)
	c.JSON(http.StatusOK, record)
}

// applyPaymentLinkStatus maps a Razorpay payment_link status onto our
// BillingStatus and persists it — shared by the manual refresh path and the
// webhook handler so both update state identically.
func applyPaymentLinkStatus(db *gorm.DB, record *models.BillingRecord, rzStatus string) {
	var status models.BillingStatus
	switch rzStatus {
	case "paid":
		status = models.BillingStatusPaid
	case "cancelled":
		status = models.BillingStatusCancelled
	case "expired":
		status = models.BillingStatusExpired
	default:
		return // "created"/unknown — leave as pending, nothing changed
	}
	if record.Status == status {
		return
	}
	updates := map[string]any{"status": status}
	if status == models.BillingStatusPaid && record.PaidAt == nil {
		now := time.Now()
		updates["paid_at"] = now
	}
	db.Model(record).Updates(updates)
	record.Status = status
}

// Cancel handles DELETE /superadmin/billing/:id — voids a still-pending
// invoice. A paid record is financial history and is never deleted here.
func (h *BillingHandler) Cancel(c *gin.Context) {
	var record models.BillingRecord
	if err := h.db.First(&record, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Billing record not found"})
		return
	}
	if record.Status == models.BillingStatusPaid {
		c.JSON(http.StatusConflict, gin.H{"error": "Can't cancel a record that's already been paid"})
		return
	}
	if record.RazorpayPaymentLinkID != "" {
		_ = h.rz.CancelPaymentLink(record.RazorpayPaymentLinkID) // best-effort — our own record is the source of truth either way
	}
	h.db.Model(&record).Update("status", models.BillingStatusCancelled)
	writeAudit(h.db, c, &record.OrgID, "cancel", "billing_record", &record.ID, nil)
	c.JSON(http.StatusOK, gin.H{"message": "Billing record cancelled"})
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

// Webhook handles POST /webhooks/razorpay — public (no session auth), gated
// entirely on the signature. Reads the raw body itself: signature
// verification has to run over exactly the bytes Razorpay signed, before
// any JSON parsing, or a byte-for-byte mismatch (whitespace, key order)
// would silently break every webhook.
func (h *BillingHandler) Webhook(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not read body"})
		return
	}
	if !razorpay.VerifyWebhookSignature(body, c.GetHeader("X-Razorpay-Signature")) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		return
	}

	var payload struct {
		Event   string `json:"event"`
		Payload struct {
			PaymentLink struct {
				Entity struct {
					ID     string `json:"id"`
					Status string `json:"status"`
				} `json:"entity"`
			} `json:"payment_link"`
			Payment struct {
				Entity struct {
					ID string `json:"id"`
				} `json:"entity"`
			} `json:"payment"`
		} `json:"payload"`
	}
	// json.Unmarshal on the bytes already read above, not c.ShouldBindJSON —
	// the request body reader was already consumed by io.ReadAll for
	// signature verification, so binding from c.Request.Body a second time
	// would always see EOF.
	if err := json.Unmarshal(body, &payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "malformed payload"})
		return
	}

	linkID := payload.Payload.PaymentLink.Entity.ID
	if linkID == "" {
		// Not a payment-link event we track (Razorpay sends many event
		// types to the same URL) — acknowledge so it isn't retried forever.
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	var record models.BillingRecord
	if err := h.db.Where("razorpay_payment_link_id = ?", linkID).First(&record).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"status": "unknown_link"})
		return
	}

	// Idempotent by construction: applyPaymentLinkStatus is a no-op if the
	// status hasn't changed, so a retried webhook (Razorpay retries on
	// anything but a 2xx) never double-processes a payment.
	if payload.Payload.Payment.Entity.ID != "" {
		h.db.Model(&record).Update("razorpay_payment_id", payload.Payload.Payment.Entity.ID)
	}
	applyPaymentLinkStatus(h.db, &record, payload.Payload.PaymentLink.Entity.Status)

	c.JSON(http.StatusOK, gin.H{"status": "processed"})
}
