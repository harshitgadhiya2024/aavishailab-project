package handlers

// Integration test for the self-serve funnel backend against a real Postgres:
// checkout, payment activation, the read-only gate, trial expiry, renewals,
// lapse, demo booking slot locking, cancel and reminders. Opt-in: set
// FUNNEL_IT_DSN to a THROWAWAY database (its public schema is wiped), e.g.
//   docker run --rm -e POSTGRES_PASSWORD=it -e POSTGRES_DB=it -p 56790:5432 postgres:16-alpine
//   FUNNEL_IT_DSN="host=127.0.0.1 port=56790 user=postgres password=it dbname=it sslmode=disable" go test ./internal/handlers -run TestFunnelIntegration

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/aavishield/admin-api/internal/database"
	"github.com/aavishield/admin-api/internal/lifecycle"
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
)

func TestFunnelIntegration(t *testing.T) {
	dsn := os.Getenv("FUNNEL_IT_DSN")
	if dsn == "" {
		t.Skip("FUNNEL_IT_DSN not set")
	}
	t.Setenv("RAZORPAY_KEY_ID", "") // invoices without payment links
	t.Setenv("RAZORPAY_KEY_SECRET", "")
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(db.Exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`).Error)
	enums, err := os.ReadFile("../../../../infra/postgres/init-enums.sql")
	must(err)
	must(db.Exec(string(enums)).Error)
	// The enum script on disk already has 'expired'; drop it back to the old
	// shape to prove the startup migration adds it to an existing database.
	must(db.Exec(`DROP TYPE org_status; CREATE TYPE org_status AS ENUM ('active','inactive','suspended','trial')`).Error)
	must(db.AutoMigrate(&models.Organization{}, &models.User{}, &models.AuditLog{}, &models.BillingRecord{},
		&models.DemoRequest{}, &models.PricingPlan{}, &models.PlatformSetting{}))
	// Teams and employees reference each other; this throwaway schema only
	// needs the tables, so skip foreign keys for the device-side models.
	dbNoFK := db.Session(&gorm.Session{})
	dbNoFK.Config.DisableForeignKeyConstraintWhenMigrating = true
	must(dbNoFK.AutoMigrate(&models.Team{}, &models.Employee{}, &models.Device{}, &models.EmployeeNotification{}))
	dbNoFK.Config.DisableForeignKeyConstraintWhenMigrating = false
	must(database.MigrateOrgStatuses(db))
	must(database.MigrateOrgStatuses(db)) // idempotent
	database.MigrateDemoSlotIndex(db)

	now := time.Now()
	newOrg := func(name string, selfServe bool) (models.Organization, models.User) {
		ends := now.Add(2 * time.Hour)
		org := models.Organization{Name: name, Slug: name, Status: models.OrgStatusTrial, Plan: models.PlanTrial,
			SelfServe: selfServe, TrialEndsAt: &ends, TrialDeviceLimit: 1, Timezone: "Asia/Kolkata"}
		must(db.Create(&org).Error)
		u := models.User{OrgID: &org.ID, Email: name + "@example.com", FirstName: "Asha", LastName: "Rao",
			Role: models.RoleOrgAdmin, Status: models.StatusActive, PasswordHash: "x"}
		must(db.Create(&u).Error)
		return org, u
	}
	org, admin := newOrg("acme", true)
	salesOrg, salesAdmin := newOrg("bigco", false)

	gin.SetMode(gin.TestMode)
	router := func(o models.Organization, u models.User) *gin.Engine {
		r := gin.New()
		v1 := r.Group("/api/v1")
		v1.Use(func(c *gin.Context) {
			c.Set(middleware.ContextKeyUserID, u.ID)
			c.Set(middleware.ContextKeyRole, models.RoleOrgAdmin)
			c.Set("scoped_org_id", o.ID.String())
		}, middleware.ExpiredOrgGate(db))
		bh := NewSelfServeBillingHandler(db)
		v1.GET("/billing", bh.Get)
		v1.POST("/billing/quote", bh.Quote)
		v1.POST("/billing/checkout", bh.Checkout)
		dh := NewDemoBookingHandler(db)
		v1.POST("/demo-booking", dh.Book)
		v1.DELETE("/demo-booking", dh.Cancel)
		v1.POST("/policies", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
		ah := &AgentHandler{db: db}
		v1.POST("/devices/:id/reconnect-link", ah.SendReconnectLink)
		return r
	}
	call := func(r *gin.Engine, method, path, body string) (int, map[string]any) {
		t.Helper()
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		out := map[string]any{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	reload := func() models.Organization {
		var o models.Organization
		must(db.First(&o, "id = ?", org.ID).Error)
		return o
	}
	r := router(org, admin)

	// ── Quote and checkout ──
	if code, q := call(r, "POST", "/api/v1/billing/quote", `{"plan":"business","seats":20,"billing_cycle":"yearly"}`); code != 200 || q["total_minor"].(float64) != 8493640 {
		t.Fatalf("quote: %d %v", code, q)
	}
	if code, _ := call(r, "POST", "/api/v1/billing/quote", `{"plan":"business","seats":200}`); code != 422 {
		t.Fatalf("seats over range: %d", code)
	}
	if code, out := call(router(salesOrg, salesAdmin), "POST", "/api/v1/billing/checkout", `{"plan":"business","seats":20}`); code != 409 || out["code"] != "sales_led" {
		t.Fatalf("sales-led checkout: %d %v", code, out)
	}
	code, out := call(r, "POST", "/api/v1/billing/checkout", `{"plan":"business","seats":20,"billing_cycle":"yearly"}`)
	if code != 201 || out["pay_url"] != "" {
		t.Fatalf("checkout: %d %v", code, out)
	}
	first := out["invoice"].(map[string]any)["id"].(string)
	if code, out := call(r, "POST", "/api/v1/billing/checkout", `{"plan":"business","seats":20,"billing_cycle":"yearly"}`); code != 200 || out["invoice"].(map[string]any)["id"] != first {
		t.Fatalf("same checkout should reuse invoice: %d %v", code, out)
	}
	code, out = call(r, "POST", "/api/v1/billing/checkout", `{"plan":"business","seats":25,"billing_cycle":"yearly"}`)
	if code != 201 {
		t.Fatalf("changed checkout: %d %v", code, out)
	}
	second := out["invoice"].(map[string]any)["id"].(string)
	var old models.BillingRecord
	must(db.First(&old, "id = ?", first).Error)
	if old.Status != models.BillingStatusCancelled {
		t.Fatalf("replaced invoice should be cancelled, is %s", old.Status)
	}

	// ── Trial reminder, then expiry ──
	runner := lifecycle.New(db)
	runner.OnExpire = middleware.ForgetOrgStatus
	runner.RunOnce(now)
	if o := reload(); o.Status != models.OrgStatusTrial || o.Settings["trial_notice_1d_at"] == nil {
		t.Fatalf("1-day notice not recorded: %s %v", o.Status, o.Settings)
	}
	runner.RunOnce(now.Add(3 * time.Hour))
	if o := reload(); o.Status != models.OrgStatusExpired || o.ExpiredAt == nil {
		t.Fatalf("trial should have expired: %s", o.Status)
	}
	if salesNow := func() models.OrgStatus {
		var o models.Organization
		db.First(&o, "id = ?", salesOrg.ID)
		return o.Status
	}(); salesNow != models.OrgStatusTrial {
		t.Fatalf("sales-led trial must not auto-expire, is %s", salesNow)
	}

	// ── Read-only gate ──
	if code, out := call(r, "POST", "/api/v1/policies", `{}`); code != 402 || out["code"] != "trial_expired" {
		t.Fatalf("expired write should be refused: %d %v", code, out)
	}
	if code, _ := call(r, "GET", "/api/v1/billing", ``); code != 200 {
		t.Fatalf("expired read: %d", code)
	}
	if code, _ := call(r, "POST", "/api/v1/billing/quote", `{"plan":"business","seats":20}`); code != 200 {
		t.Fatalf("expired billing write: %d", code)
	}

	// ── Payment activates (and is idempotent) ──
	var rec models.BillingRecord
	must(db.First(&rec, "id = ?", second).Error)
	applyPaymentLinkStatus(db, &rec, "paid")
	o := reload()
	if o.Status != models.OrgStatusActive || o.Plan != models.PlanProfessional || o.PaidThrough == nil || o.ExpiredAt != nil {
		t.Fatalf("payment should activate: %s %s %v", o.Status, o.Plan, o.PaidThrough)
	}
	if d := o.PaidThrough.Sub(now); d < 364*24*time.Hour || d > 367*24*time.Hour {
		t.Fatalf("paid through should be a year out, is %s", d)
	}
	applySelfServePayment(db, &rec)
	if again := reload(); !again.PaidThrough.Equal(*o.PaidThrough) {
		t.Fatal("second activation of the same record extended the period")
	}
	if code, _ := call(r, "POST", "/api/v1/policies", `{}`); code != 200 {
		t.Fatalf("paid org write: %d", code)
	}
	if code, out := call(r, "POST", "/api/v1/billing/checkout", `{"plan":"business","seats":25}`); code != 409 || out["code"] != "already_paid" {
		t.Fatalf("early re-checkout: %d %v", code, out)
	}

	// ── Renewal invoice a week out, once; paying it stacks the year ──
	soon := now.Add(3 * 24 * time.Hour)
	must(db.Model(&models.Organization{}).Where("id = ?", org.ID).Update("paid_through", soon).Error)
	runner.RunOnce(now)
	runner.RunOnce(now)
	var renewals []models.BillingRecord
	db.Where("org_id = ? AND source = ?", org.ID, models.BillingSourceRenewal).Find(&renewals)
	if len(renewals) != 1 || renewals[0].Seats != 25 || renewals[0].Plan != models.PlanProfessional {
		t.Fatalf("want one renewal for 25 seats, got %+v", renewals)
	}
	applyPaymentLinkStatus(db, &renewals[0], "paid")
	if d := reload().PaidThrough.Sub(soon); d < 364*24*time.Hour || d > 367*24*time.Hour {
		t.Fatalf("renewal should extend from the old end date, got +%s", d)
	}

	// ── Unpaid past the grace week lapses ──
	must(db.Model(&models.Organization{}).Where("id = ?", org.ID).Update("paid_through", now.Add(-8*24*time.Hour)).Error)
	runner.RunOnce(now)
	if s := reload().Status; s != models.OrgStatusExpired {
		t.Fatalf("lapsed subscription should expire, is %s", s)
	}
	must(db.Model(&models.Organization{}).Where("id = ?", org.ID).Updates(map[string]any{"status": models.OrgStatusActive, "paid_through": now.AddDate(1, 0, 0)}).Error)
	middleware.ForgetOrgStatus(org.ID.String())

	// ── Demo slot: one company per slot, cancel frees it ──
	ist, _ := time.LoadLocation("Asia/Kolkata")
	slot := now.In(ist).AddDate(0, 0, 3)
	for slot.Weekday() == time.Saturday || slot.Weekday() == time.Sunday {
		slot = slot.AddDate(0, 0, 1)
	}
	slot = time.Date(slot.Year(), slot.Month(), slot.Day(), 11, 0, 0, 0, ist)
	body := `{"preferred_at":"` + slot.Format(time.RFC3339) + `","timezone":"Asia/Kolkata"}`
	if code, out := call(r, "POST", "/api/v1/demo-booking", body); code != 201 {
		t.Fatalf("book: %d %v", code, out)
	}
	salesR := router(salesOrg, salesAdmin)
	if code, _ := call(salesR, "POST", "/api/v1/demo-booking", body); code != 409 {
		t.Fatalf("second company on same slot: %d", code)
	}
	// The index also stops a direct insert that skips the handler's check.
	other := uuid.New()
	err = db.Create(&models.DemoRequest{Name: "x", Email: "x@y.co", Company: "x", OrgID: &other, PreferredAt: ptrTime(slot.UTC()), Status: models.DemoRequestNew}).Error
	if !isUniqueViolation(err) {
		t.Fatalf("unique slot index missing: %v", err)
	}
	// Rescheduling moves the same booking and bumps the calendar sequence.
	slotB := slot.Add(90 * time.Minute)
	if code, out := call(r, "POST", "/api/v1/demo-booking", `{"preferred_at":"`+slotB.Format(time.RFC3339)+`","timezone":"Asia/Kolkata"}`); code != 201 {
		t.Fatalf("reschedule: %d %v", code, out)
	}
	var mine models.DemoRequest
	must(db.Where("org_id = ? AND status <> ?", org.ID, models.DemoRequestClosed).First(&mine).Error)
	if mine.CalendarSeq != 1 || !mine.PreferredAt.Equal(slotB.UTC()) {
		t.Fatalf("reschedule should move one booking to seq 1: seq %d at %v", mine.CalendarSeq, mine.PreferredAt)
	}
	// Back to the original slot for the clash checks below.
	if code, _ := call(r, "POST", "/api/v1/demo-booking", body); code != 201 {
		t.Fatalf("move back: %d", code)
	}
	if code, out := call(r, "DELETE", "/api/v1/demo-booking", ``); code != 200 {
		t.Fatalf("cancel: %d %v", code, out)
	}
	must(db.First(&mine, "id = ?", mine.ID).Error)
	if mine.CalendarSeq != 3 || mine.CancelledAt == nil {
		t.Fatalf("cancel should bump seq to 3 and stamp the time: %d %v", mine.CalendarSeq, mine.CancelledAt)
	}
	if code, _ := call(r, "DELETE", "/api/v1/demo-booking", ``); code != 404 {
		t.Fatalf("cancel twice: %d", code)
	}
	if code, out := call(salesR, "POST", "/api/v1/demo-booking", body); code != 201 {
		t.Fatalf("slot should be free after cancel: %d %v", code, out)
	}

	// ── Reconnect link for a revoked device ──
	emp := models.Employee{OrgID: org.ID, FirstName: "Jay", LastName: "K", Email: "jay@example.com", Status: models.StatusActive}
	must(db.Create(&emp).Error)
	dev := models.Device{OrgID: org.ID, EmployeeID: &emp.ID, Hostname: "DESKTOP-1", Status: "online"}
	must(db.Create(&dev).Error)
	linkPath := "/api/v1/devices/" + dev.ID.String() + "/reconnect-link"
	if code, _ := call(r, "POST", linkPath, ``); code != 409 {
		t.Fatalf("link for a connected device: %d", code)
	}
	must(db.Model(&dev).Update("status", "revoked").Error)
	if code, out := call(r, "POST", linkPath, ``); code != 200 || out["email"] != "jay@example.com" {
		t.Fatalf("reconnect link: %d %v", code, out)
	}
	if code, _ := call(r, "POST", linkPath, ``); code != 429 {
		t.Fatalf("second link inside cooldown: %d", code)
	}
	var notes int64
	db.Model(&models.EmployeeNotification{}).Where("employee_id = ?", emp.ID).Count(&notes)
	if notes != 1 {
		t.Fatalf("want one portal notice, got %d", notes)
	}
	if code, _ := call(salesR, "POST", linkPath, ``); code != 404 {
		t.Fatalf("another company's device must be invisible: %d", code)
	}

	// ── Day-before reminder, once ──
	var b models.DemoRequest
	must(db.Where("org_id = ? AND status <> ?", salesOrg.ID, models.DemoRequestClosed).First(&b).Error)
	must(db.Model(&b).Update("created_at", slot.Add(-72*time.Hour)).Error)
	runner.RunOnce(slot.Add(-20 * time.Hour))
	must(db.First(&b, "id = ?", b.ID).Error)
	if b.Reminder24hSentAt == nil || b.Reminder1hSentAt != nil {
		t.Fatalf("want only the day-before reminder: %v %v (slot %v created %v status %s org %v)",
			b.Reminder24hSentAt, b.Reminder1hSentAt, b.PreferredAt, b.CreatedAt, b.Status, b.OrgID)
	}
	runner.RunOnce(slot.Add(-50 * time.Minute))
	must(db.First(&b, "id = ?", b.ID).Error)
	if b.Reminder1hSentAt == nil {
		t.Fatal("hour-before reminder not sent")
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
