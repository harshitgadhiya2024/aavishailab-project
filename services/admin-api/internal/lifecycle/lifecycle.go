// Package lifecycle runs the time-driven steps of the self-serve funnel:
// demo reminders, trial reminders and expiry, and subscription renewals.
//
// Unlike the notifier it runs whether or not email is configured, because
// some steps change state (a trial expiring) and must happen regardless. Each
// email is sent once, guarded by a marker on the row it belongs to.
package lifecycle

import (
	"log"
	"time"

	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/razorpay"
	"github.com/aavishield/admin-api/internal/subscription"
)

const (
	// RenewalLead is how long before PaidThrough the renewal invoice goes out.
	RenewalLead = 7 * 24 * time.Hour
	// LapseGrace is how long after PaidThrough an unpaid company keeps full
	// access before turning read-only.
	LapseGrace = 7 * 24 * time.Hour

	demoTeamZone = "Asia/Kolkata"

	markTrial3d    = "trial_notice_3d_at"
	markTrial1d    = "trial_notice_1d_at"
	markRenewalFor = "renewal_invoiced_for"
)

// Runner owns the database handle and the Razorpay client for renewals.
type Runner struct {
	db *gorm.DB
	rz *razorpay.Client
	// OnExpire, when set, is told about each org that turned read-only, so the
	// API can drop its cached status at once.
	OnExpire func(orgID string)
}

func New(db *gorm.DB) *Runner { return &Runner{db: db, rz: razorpay.New()} }

// Start runs RunOnce on a ticker, after a short delay so a restart doesn't
// race the migrations or mail everyone at boot.
func (r *Runner) Start(interval time.Duration) {
	go func() {
		time.Sleep(30 * time.Second)
		for {
			r.RunOnce(time.Now())
			time.Sleep(interval)
		}
	}()
	log.Printf("⏱️  Lifecycle jobs running every %s (demo reminders, trials, renewals)", interval)
}

// RunOnce does every step once, as of now.
func (r *Runner) RunOnce(now time.Time) {
	r.demoReminders(now)
	r.trials(now)
	r.renewals(now)
}

// ─── Demo reminders ──────────────────────────────────────────────────────────

// DemoReminderDue says which reminder a booking needs now: "24h", "1h" or "".
// The day-before reminder only goes to bookings made more than a day ahead
// (otherwise the booking confirmation is fresh enough), and is skipped once
// the one-hour reminder is due.
func DemoReminderDue(now, slot, createdAt time.Time, sent24h, sent1h bool) string {
	until := slot.Sub(now)
	if until <= 0 {
		return ""
	}
	if until <= 75*time.Minute {
		if !sent1h {
			return "1h"
		}
		return ""
	}
	if until <= 24*time.Hour && !sent24h && slot.Sub(createdAt) > 24*time.Hour {
		return "24h"
	}
	return ""
}

func (r *Runner) demoReminders(now time.Time) {
	var bookings []models.DemoRequest
	r.db.Where("org_id IS NOT NULL AND preferred_at BETWEEN ? AND ? AND status <> ?",
		now, now.Add(25*time.Hour), models.DemoRequestClosed).Find(&bookings)
	for i := range bookings {
		b := &bookings[i]
		due := DemoReminderDue(now, *b.PreferredAt, b.CreatedAt, b.Reminder24hSentAt != nil, b.Reminder1hSentAt != nil)
		if due == "" {
			continue
		}
		// Mark first, then send: a failed write must not mean a reminder every tick.
		col, lead := "reminder_24h_sent_at", "tomorrow"
		if due == "1h" {
			col, lead = "reminder_1h_sent_at", "in an hour"
		}
		if err := r.db.Model(&models.DemoRequest{}).Where("id = ?", b.ID).UpdateColumn(col, now).Error; err != nil {
			log.Printf("⏱️  demo reminder for %s not marked, skipping: %v", b.ID, err)
			continue
		}
		mailer.DemoReminder(b.Email, firstName(b.Name), formatSlot(*b.PreferredAt, b.Timezone), lead, b.MeetingURL)
	}
}

// ─── Trials ──────────────────────────────────────────────────────────────────

// TrialStep says what a self-serve trial needs now: "expire", "1d", "3d" or "".
func TrialStep(now, endsAt time.Time, sent3d, sent1d bool) string {
	left := endsAt.Sub(now)
	switch {
	case left <= 0:
		return "expire"
	case left <= 24*time.Hour:
		if !sent1d {
			return "1d"
		}
	case left <= 3*24*time.Hour:
		if !sent3d && !sent1d {
			return "3d"
		}
	}
	return ""
}

func (r *Runner) trials(now time.Time) {
	var orgs []models.Organization
	r.db.Where("self_serve = ? AND status = ? AND trial_ends_at IS NOT NULL AND trial_ends_at < ?",
		true, models.OrgStatusTrial, now.Add(3*24*time.Hour+time.Hour)).Find(&orgs)
	for i := range orgs {
		org := &orgs[i]
		step := TrialStep(now, *org.TrialEndsAt, marked(org, markTrial3d), marked(org, markTrial1d))
		switch step {
		case "expire":
			r.expire(org, now, false)
		case "1d", "3d":
			days := 1
			key := markTrial1d
			if step == "3d" {
				days, key = int((org.TrialEndsAt.Sub(now)+23*time.Hour)/(24*time.Hour)), markTrial3d
			}
			mailer.TrialEndingSoon(subscription.AdminEmails(r.db, org.ID), org.Name, days, formatDate(*org.TrialEndsAt, org.Timezone))
			r.mark(org, key, now.Format(time.RFC3339))
		}
	}
}

// expire turns the org read-only and tells its admins.
func (r *Runner) expire(org *models.Organization, now time.Time, lapsed bool) {
	res := r.db.Model(&models.Organization{}).
		Where("id = ? AND status IN ?", org.ID, []models.OrgStatus{models.OrgStatusTrial, models.OrgStatusActive}).
		Updates(map[string]any{"status": models.OrgStatusExpired, "expired_at": now})
	if res.Error != nil || res.RowsAffected == 0 {
		return
	}
	reason := "trial_ended"
	if lapsed {
		reason = "subscription_lapsed"
	}
	r.db.Create(&models.AuditLog{OrgID: &org.ID, Action: "expire", Resource: "organization", ResourceID: &org.ID,
		Changes: map[string]any{"status": models.OrgStatusExpired, "reason": reason}})
	log.Printf("⏱️  %s (%s): %s, console now read-only", org.Name, org.ID, reason)
	if r.OnExpire != nil {
		r.OnExpire(org.ID.String())
	}
	mailer.TrialEnded(subscription.AdminEmails(r.db, org.ID), org.Name, lapsed)
}

// ─── Renewals ────────────────────────────────────────────────────────────────

// RenewalStep says what a paid self-serve company needs now: "lapse",
// "invoice" or "". invoicedFor is the PaidThrough the last renewal invoice was
// raised for (empty if none).
func RenewalStep(now, paidThrough time.Time, invoicedFor string, renewalPaid bool) string {
	if renewalPaid {
		return ""
	}
	if now.After(paidThrough.Add(LapseGrace)) {
		return "lapse"
	}
	if now.After(paidThrough.Add(-RenewalLead)) && invoicedFor != paidThrough.UTC().Format(time.RFC3339) {
		return "invoice"
	}
	return ""
}

func (r *Runner) renewals(now time.Time) {
	var orgs []models.Organization
	r.db.Where("self_serve = ? AND status = ? AND paid_through IS NOT NULL AND paid_through < ?",
		true, models.OrgStatusActive, now.Add(RenewalLead+time.Hour)).Find(&orgs)
	for i := range orgs {
		org := &orgs[i]
		invoicedFor, _ := org.Settings[markRenewalFor].(string)
		switch RenewalStep(now, *org.PaidThrough, invoicedFor, false) {
		case "lapse":
			r.expire(org, now, true)
		case "invoice":
			r.raiseRenewal(org, now)
		}
	}
}

func (r *Runner) raiseRenewal(org *models.Organization, now time.Time) {
	seats, cycle := 0, subscription.CycleAnnual
	if org.Onboarding != nil {
		if v, ok := org.Onboarding["seats"].(float64); ok {
			seats = int(v)
		}
		if v, ok := org.Onboarding["billing_cycle"].(string); ok {
			cycle = subscription.NormalizeCycle(v)
		}
	}
	plan, ok := subscription.LoadPlan(r.db, org.Plan)
	if !ok || seats == 0 {
		log.Printf("⏱️  renewal for %s skipped: plan %q or seats %d unknown", org.ID, org.Plan, seats)
		r.mark(org, markRenewalFor, org.PaidThrough.UTC().Format(time.RFC3339))
		return
	}
	q, err := subscription.Compute(plan, subscription.Settings(r.db), seats, cycle, razorpay.Currency())
	if err != nil {
		// The plan's device range changed since they bought; the team renews by hand.
		log.Printf("⏱️  renewal for %s needs the team: %v", org.ID, err)
		r.mark(org, markRenewalFor, org.PaidThrough.UTC().Format(time.RFC3339))
		return
	}
	record, err := subscription.CreateInvoice(r.db, r.rz, org, q, *org.PaidThrough, models.BillingSourceRenewal, nil)
	if err != nil {
		log.Printf("⏱️  renewal invoice for %s failed, will retry: %v", org.ID, err)
		return
	}
	r.mark(org, markRenewalFor, org.PaidThrough.UTC().Format(time.RFC3339))
	mailer.InvoiceRaised(subscription.AdminEmails(r.db, org.ID), org.Name, q.PlanName, q.Seats, q.Cycle, q.Display, record.ShortURL, true)
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func marked(org *models.Organization, key string) bool {
	return org.Settings != nil && org.Settings[key] != nil
}

func (r *Runner) mark(org *models.Organization, key, value string) {
	if org.Settings == nil {
		org.Settings = map[string]any{}
	}
	org.Settings[key] = value
	r.db.Model(org).Update("settings", org.Settings)
}

func formatSlot(slot time.Time, zone string) string {
	loc, err := time.LoadLocation(zone)
	if err != nil || zone == "" {
		loc, _ = time.LoadLocation(demoTeamZone)
	}
	return slot.In(loc).Format("Monday, 2 January 2006 at 3:04 PM") + " (" + loc.String() + ")"
}

func formatDate(t time.Time, zone string) string {
	loc, err := time.LoadLocation(zone)
	if err != nil || zone == "" {
		loc = time.UTC
	}
	return t.In(loc).Format("2 January 2006")
}

func firstName(full string) string {
	for i, ch := range full {
		if ch == ' ' {
			return full[:i]
		}
	}
	return full
}
