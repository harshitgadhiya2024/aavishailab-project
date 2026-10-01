package handlers

// The whole access-request flow against a real Postgres: an employee is
// blocked, asks for access from that activity row, the company approves, and
// the exception reaches what their device is sent; revoking takes it back.
// Opt-in, like the other integration tests: set ACCESS_IT_DSN to a THROWAWAY
// database (its public schema is wiped).

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestAccessRequestFlowIntegration(t *testing.T) {
	dsn := os.Getenv("ACCESS_IT_DSN")
	if dsn == "" {
		t.Skip("ACCESS_IT_DSN not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableForeignKeyConstraintWhenMigrating: true})
	if err != nil {
		t.Fatal(err)
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(db.Exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).Error)
	enums, err := os.ReadFile("../../../../infra/postgres/init-enums.sql")
	must(err)
	must(db.Exec(string(enums)).Error)
	must(db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error)
	must(db.AutoMigrate(&models.Organization{}, &models.User{}, &models.Employee{}, &models.ActivityEvent{},
		&models.AccessRequest{}, &models.AuditLog{}, &models.ManagedApplication{}, &models.AppControlRule{}, &models.Policy{}))

	org := models.Organization{Name: "Delphic", Slug: "delphic-" + uuid.NewString()[:8]}
	must(db.Create(&org).Error)
	emp := models.Employee{OrgID: org.ID, Email: "riya@delphic.test", FirstName: "Riya", LastName: "Patel"}
	must(db.Create(&emp).Error)
	other := models.Employee{OrgID: org.ID, Email: "harshit@delphic.test", FirstName: "Harshit", LastName: "Patel"}
	must(db.Create(&other).Error)
	admin := uuid.New()

	h := NewAccessRequestHandler(db)
	call := func(fn gin.HandlerFunc, portal bool, path string, body any, params gin.Params) (int, map[string]any) {
		t.Helper()
		b, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Params = params
		if portal {
			c.Set("portal_employee_id", emp.ID.String())
			c.Set("portal_org_id", org.ID.String())
		} else {
			c.Set("scoped_org_id", org.ID.String())
			c.Set(middleware.ContextKeyUserID, admin)
		}
		fn(c)
		var out map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	ev := func(e models.ActivityEvent) models.ActivityEvent {
		e.OrgID, e.EmployeeID, e.Timestamp = org.ID, &emp.ID, time.Now()
		must(db.Create(&e).Error)
		return e
	}

	// ── Website ───────────────────────────────────────────────────────────
	webEv := ev(models.ActivityEvent{EventType: models.EventTypeWebRequest, Action: models.EventActionBlocked,
		Target: "https://payroll.razorpay.com", TargetDomain: "payroll.razorpay.com", Category: "url_category", PolicyName: "Policy: Banking"})

	if code, _ := call(h.Create, true, "/", map[string]any{"event_id": webEv.ID, "reason": ""}, nil); code != http.StatusBadRequest {
		t.Fatalf("a request without a reason should be refused, got %d", code)
	}
	code, created := call(h.Create, true, "/", map[string]any{"event_id": webEv.ID, "reason": "Need payroll for salary slips"}, nil)
	if code != http.StatusCreated || created["kind"] != "website" || created["resource"] != "payroll.razorpay.com" {
		t.Fatalf("create website request: %d %v", code, created)
	}
	reqID := created["id"].(string)

	// Asking again returns the same open request.
	if code, again := call(h.Create, true, "/", map[string]any{"event_id": webEv.ID, "reason": "please, again"}, nil); code != http.StatusOK || again["id"] != reqID {
		t.Fatalf("duplicate request should return the open one: %d %v", code, again)
	}

	// Someone else's event can't be used.
	foreign := models.ActivityEvent{OrgID: org.ID, EmployeeID: &other.ID, EventType: models.EventTypeWebRequest, Action: models.EventActionBlocked, TargetDomain: "x.com", Timestamp: time.Now()}
	must(db.Create(&foreign).Error)
	if code, _ := call(h.Create, true, "/", map[string]any{"event_id": foreign.ID, "reason": "not mine at all"}, nil); code != http.StatusNotFound {
		t.Fatalf("another employee's event must not be requestable, got %d", code)
	}

	// Device posture can't be requested.
	posture := ev(models.ActivityEvent{EventType: models.EventTypePolicyViol, Action: models.EventActionAlerted, Category: "device_posture", Target: "device-posture"})
	if code, _ := call(h.Create, true, "/", map[string]any{"event_id": posture.ID, "reason": "posture please"}, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("posture should not be requestable, got %d", code)
	}

	// Before approval the block stands.
	orgID := org.ID
	rules := []models.DomainRule{
		{OrgID: &orgID, Domain: "razorpay.com", Action: models.PolicyActionBlock},
		{OrgID: &orgID, Domain: "payroll.razorpay.com", Action: models.PolicyActionBlock},
	}
	got := filterApprovedExceptions(db, append([]models.DomainRule(nil), rules...), org.ID, emp.ID)
	if len(got) != 2 {
		t.Fatalf("pending request must not change rules: %+v", got)
	}

	// Approve → the exact host is allowed, the parent block stays.
	if code, out := call(h.Approve, false, "/", map[string]any{"note": "ok for payroll"}, gin.Params{{Key: "id", Value: reqID}}); code != http.StatusOK || out["status"] != "approved" {
		t.Fatalf("approve: %d %v", code, out)
	}
	if code, _ := call(h.Approve, false, "/", nil, gin.Params{{Key: "id", Value: reqID}}); code != http.StatusConflict {
		t.Fatalf("approving twice should conflict, got %d", code)
	}
	got = filterApprovedExceptions(db, append([]models.DomainRule(nil), rules...), org.ID, emp.ID)
	actions := map[string]models.PolicyAction{}
	for _, r := range got {
		actions[r.Domain] = r.Action
	}
	if actions["payroll.razorpay.com"] != models.PolicyActionAllow || actions["razorpay.com"] != models.PolicyActionBlock {
		t.Fatalf("after approval want payroll allowed and parent still blocked, got %v", actions)
	}
	if got := filterApprovedExceptions(db, append([]models.DomainRule(nil), rules...), org.ID, other.ID); len(got) != 2 {
		t.Fatalf("another employee must be unaffected: %+v", got)
	}

	// A platform-wide (risk engine) block is never lifted by an approval.
	withPlatform := append(append([]models.DomainRule(nil), rules...), models.DomainRule{Domain: "payroll.razorpay.com", Action: models.PolicyActionBlock})
	for _, r := range filterApprovedExceptions(db, withPlatform, org.ID, emp.ID) {
		if r.Domain == "payroll.razorpay.com" && r.Action == models.PolicyActionAllow {
			t.Fatal("approval must not override a platform block")
		}
	}

	// The portal shows every row for that host as granted.
	p := &PortalHandler{db: db}
	rows := p.withAccess(emp.ID, []models.ActivityEvent{webEv, posture})
	if rows[0].Access == nil || rows[0].Access.Status != models.AccessRequestApproved || rows[1].Access != nil {
		t.Fatalf("portal access state: %+v / %+v", rows[0].Access, rows[1].Access)
	}

	// Revoke → blocked again.
	if code, out := call(h.Revoke, false, "/", nil, gin.Params{{Key: "id", Value: reqID}}); code != http.StatusOK || out["status"] != "revoked" {
		t.Fatalf("revoke: %d %v", code, out)
	}
	if got := filterApprovedExceptions(db, append([]models.DomainRule(nil), rules...), org.ID, emp.ID); len(got) != 2 || got[1].Action != models.PolicyActionBlock {
		t.Fatalf("after revoke the block should be back: %+v", got)
	}

	// ── Application ───────────────────────────────────────────────────────
	app := models.ManagedApplication{Name: "Visual Studio Code", ProcessNames: []string{"Code"}, Domains: []string{"vscode.dev"}}
	must(db.Create(&app).Error)
	must(db.Create(&models.AppControlRule{OrgID: org.ID, ApplicationID: app.ID, Action: "block", Enabled: true, BlockProcess: true, BlockNetwork: true}).Error)
	if len(appControlMatchers(db, org.ID, &emp.ID, nil)) != 1 {
		t.Fatal("app should be blocked before approval")
	}
	appEv := ev(models.ActivityEvent{EventType: models.EventTypeProcessStart, Action: models.EventActionBlocked, Target: "Visual Studio Code",
		Category: "application_control", Metadata: map[string]any{"app_id": app.ID.String()}})
	code, created = call(h.Create, true, "/", map[string]any{"event_id": appEv.ID, "reason": "I write code for a living"}, nil)
	if code != http.StatusCreated || created["kind"] != "application" {
		t.Fatalf("create app request: %d %v", code, created)
	}
	call(h.Approve, false, "/", nil, gin.Params{{Key: "id", Value: created["id"].(string)}})
	if m := appControlMatchers(db, org.ID, &emp.ID, nil); len(m) != 0 {
		t.Fatalf("approved app must not be sent to the device: %+v", m)
	}
	if len(appControlDomainRules(db, org.ID, &emp.ID, nil)) != 0 {
		t.Fatal("approved app's network bundle must be lifted too")
	}
	if len(appControlMatchers(db, org.ID, &other.ID, nil)) != 1 {
		t.Fatal("other employees keep the app block")
	}

	// ── Browser extension ────────────────────────────────────────────────
	extEv := ev(models.ActivityEvent{EventType: models.EventTypeProcessStart, Action: models.EventActionAlerted, Target: "VeePN",
		Operation: OpBrowserExtInstalled, Category: "application_control",
		Metadata: map[string]any{"kind": "browser_extension", "extension_id": "majdfhpaihoncoakbjgbdhglocklcgno"}})
	code, created = call(h.Create, true, "/", map[string]any{"event_id": extEv.ID, "reason": "client VPN for testing"}, nil)
	if code != http.StatusCreated || created["kind"] != "browser_extension" {
		t.Fatalf("create extension request: %d %v", code, created)
	}
	call(h.Approve, false, "/", nil, gin.Params{{Key: "id", Value: created["id"].(string)}})
	for _, e := range vpnExtensionsFor(approvedGrants(db, &emp.ID).extensions) {
		if e["id"] == "majdfhpaihoncoakbjgbdhglocklcgno" {
			t.Fatal("approved extension should leave the watch list")
		}
	}

	// ── Download and DLP ─────────────────────────────────────────────────
	dlEv := ev(models.ActivityEvent{EventType: models.EventTypeFileOp, Action: models.EventActionBlocked, Target: "setup.exe",
		Category: "malware_detection", Metadata: map[string]any{"sha256": "ABC123"}})
	code, created = call(h.Create, true, "/", map[string]any{"event_id": dlEv.ID, "reason": "vendor installer, checked"}, nil)
	if code != http.StatusCreated || created["resource"] != "abc123" {
		t.Fatalf("create download request: %d %v", code, created)
	}
	call(h.Deny, false, "/", map[string]any{"note": "not safe"}, gin.Params{{Key: "id", Value: created["id"].(string)}})
	if approvedGrants(db, &emp.ID).downloads["abc123"] {
		t.Fatal("a denied download must stay blocked")
	}

	dlpEv := ev(models.ActivityEvent{EventType: models.EventTypePolicyViol, Action: models.EventActionAlerted, Category: "dlp",
		Metadata: map[string]any{"service": "Gmail"}})
	code, created = call(h.Create, true, "/", map[string]any{"event_id": dlpEv.ID, "reason": "sending offer letter to the candidate"}, nil)
	if code != http.StatusCreated || created["kind"] != "dlp" || created["label"] != "Sensitive data sent to Gmail" {
		t.Fatalf("create dlp justification: %d %v", code, created)
	}

	// ── Company list ─────────────────────────────────────────────────────
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/?status=pending", nil)
	c.Set("scoped_org_id", org.ID.String())
	h.List(c)
	var list struct {
		Data   []models.AccessRequest `json:"data"`
		Counts map[string]int64       `json:"counts"`
	}
	must(json.Unmarshal(w.Body.Bytes(), &list))
	if len(list.Data) != 1 || list.Data[0].Kind != models.AccessKindDLP || list.Data[0].Employee == nil {
		t.Fatalf("pending list: %+v", list.Data)
	}
	if list.Counts["approved"] != 2 || list.Counts["revoked"] != 1 || list.Counts["denied"] != 1 || list.Counts["pending"] != 1 {
		t.Fatalf("status counts: %v", list.Counts)
	}
}
