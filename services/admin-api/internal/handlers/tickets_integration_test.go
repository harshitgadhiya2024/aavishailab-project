package handlers

// Integration test for support tickets against a real Postgres, including the
// migration from the original ticket schema. Opt-in: set TICKETS_IT_DSN to a
// THROWAWAY database (its public schema is wiped at the start), e.g.
//   docker run --rm -e POSTGRES_PASSWORD=it -e POSTGRES_DB=it -p 56789:5432 postgres:16-alpine
//   TICKETS_IT_DSN="host=127.0.0.1 port=56789 user=postgres password=it dbname=it sslmode=disable" go test ./internal/handlers -run TestTicketsIntegration

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aavishield/admin-api/internal/database"
	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// The ticket tables as they were before conversation state existed.
type legacyTicket struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeletedAt   gorm.DeletedAt `gorm:"index"`
	OrgID       *uuid.UUID     `gorm:"type:uuid;index"`
	Subject     string         `gorm:"not null"`
	Status      string         `gorm:"type:varchar(20);default:'open'"`
	Priority    string         `gorm:"type:varchar(20);default:'normal'"`
	CreatedByID uuid.UUID      `gorm:"type:uuid;not null"`
}

func (legacyTicket) TableName() string { return "support_tickets" }

type legacyMessage struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	TicketID  uuid.UUID `gorm:"type:uuid;not null;index"`
	AuthorID  uuid.UUID `gorm:"type:uuid;not null"`
	Body      string    `gorm:"not null"`
	CreatedAt time.Time
}

func (legacyMessage) TableName() string { return "support_ticket_messages" }

func TestTicketsIntegration(t *testing.T) {
	dsn := os.Getenv("TICKETS_IT_DSN")
	if dsn == "" {
		t.Skip("TICKETS_IT_DSN not set")
	}
	t.Setenv("SCREENSHOT_R2_ENDPOINT", "")
	t.Setenv("SCREENSHOT_LOCAL_DIR", t.TempDir())
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).Error; err != nil {
		t.Fatal(err)
	}
	enums, err := os.ReadFile("../../../../infra/postgres/init-enums.sql")
	if err != nil {
		t.Fatal(err)
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(db.Exec(string(enums)).Error)
	must(db.AutoMigrate(&models.Organization{}, &models.User{}, &models.AuditLog{}, &legacyTicket{}, &legacyMessage{}))

	org := models.Organization{Name: "Delphic", Slug: "delphic-" + uuid.NewString()[:8]}
	must(db.Create(&org).Error)
	customer := models.User{OrgID: &org.ID, Email: "utsavi@delphic.test", FirstName: "Utsavi", LastName: "Narola", PasswordHash: "x", Role: "org_admin"}
	agent := models.User{Email: "harshit@aavishield.test", FirstName: "Harshit", LastName: "Gadhiya", PasswordHash: "x", Role: models.RoleSuperAdmin}
	must(db.Create(&customer).Error)
	must(db.Create(&agent).Error)

	old := legacyTicket{OrgID: &org.ID, Subject: "Agent not installing", CreatedByID: customer.ID}
	must(db.Create(&old).Error)
	must(db.Create(&legacyMessage{TicketID: old.ID, AuthorID: customer.ID, Body: "It fails", CreatedAt: time.Now().Add(-2 * time.Hour)}).Error)
	must(db.Create(&legacyMessage{TicketID: old.ID, AuthorID: agent.ID, Body: "Try again", CreatedAt: time.Now().Add(-time.Hour)}).Error)

	// Migrate to the current schema.
	must(db.AutoMigrate(&models.SupportTicket{}, &models.SupportTicketMessage{}, &models.SupportTicketAttachment{}))
	must(database.MigrateSupportTickets(db))
	must(database.MigrateSupportTickets(db)) // idempotent

	var migrated models.SupportTicket
	must(db.First(&migrated, "id = ?", old.ID).Error)
	if migrated.Number != 1001 || migrated.LastMessageSide != models.TicketSideSupport || migrated.LastMessageAt == nil {
		t.Fatalf("legacy ticket not backfilled: number=%d side=%q at=%v", migrated.Number, migrated.LastMessageSide, migrated.LastMessageAt)
	}

	h := NewTicketHandler(db)
	call := func(user uuid.UUID, org string, fn gin.HandlerFunc, method, path string, body []byte, ctype string, params gin.Params) (int, map[string]any) {
		t.Helper()
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(method, path, bytes.NewReader(body))
		if ctype != "" {
			c.Request.Header.Set("Content-Type", ctype)
		}
		c.Set(middleware.ContextKeyUserID, user)
		c.Set("scoped_org_id", org)
		c.Params = params
		fn(c)
		var m map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &m)
		return w.Code, m
	}
	jsonBody := func(v any) []byte { b, _ := json.Marshal(v); return b }
	orgID := org.ID.String()

	// A new request with a real PNG attached.
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89")
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("subject", "Firewall warning on my Mac")
	_ = mw.WriteField("body", "Dashboard says my firewall is off.")
	_ = mw.WriteField("category", "agent")
	_ = mw.WriteField("priority", "high")
	fw, _ := mw.CreateFormFile("files", "screen.png")
	_, _ = fw.Write(png)
	mw.Close()
	code, created := call(customer.ID, orgID, h.Create, "POST", "/tickets", buf.Bytes(), mw.FormDataContentType(), nil)
	if code != 201 || created["ref"] != "DS-1002" {
		t.Fatalf("create: %d %v", code, created)
	}
	id := created["id"].(string)
	p := gin.Params{{Key: "id", Value: id}}

	// A renamed executable is refused.
	buf.Reset()
	mw = multipart.NewWriter(&buf)
	_ = mw.WriteField("subject", "x")
	_ = mw.WriteField("body", "y")
	fw, _ = mw.CreateFormFile("files", "photo.png")
	_, _ = fw.Write([]byte("MZ\x90\x00 this is an exe"))
	mw.Close()
	if code, _ := call(customer.ID, orgID, h.Create, "POST", "/tickets", buf.Bytes(), mw.FormDataContentType(), nil); code != 400 {
		t.Fatalf("fake png accepted: %d", code)
	}

	// Support replies: request moves to in progress, gets an owner, and the
	// customer has one unread.
	code, _ = call(agent.ID, "", h.AddMessageAny, "POST", "/x", jsonBody(map[string]any{"body": "Open System Settings > Network > Firewall."}), "application/json", p)
	if code != 201 {
		t.Fatalf("support reply: %d", code)
	}
	var tk models.SupportTicket
	must(db.First(&tk, "id = ?", id).Error)
	if tk.Status != models.TicketStatusInProgress || tk.AssignedToID == nil || *tk.AssignedToID != agent.ID {
		t.Fatalf("after reply: status=%s assigned=%v", tk.Status, tk.AssignedToID)
	}
	if _, u := call(customer.ID, orgID, h.UnreadForOrg, "GET", "/x", nil, "", nil); u["unread"].(float64) != 2 {
		t.Fatalf("unread = %v, want 2 (legacy + new)", u["unread"])
	}

	// An internal note never reaches the customer.
	call(agent.ID, "", h.AddMessageAny, "POST", "/x", jsonBody(map[string]any{"body": "Customer on macOS 14", "internal": true}), "application/json", p)
	_, detail := call(customer.ID, orgID, h.Get, "GET", "/x", nil, "", p)
	msgs := detail["messages"].([]any)
	for _, m := range msgs {
		mm := m.(map[string]any)
		if mm["internal"] == true {
			t.Fatal("customer saw an internal note")
		}
		if mm["side"] == "support" && (mm["author_name"] != "Harshit" || mm["author_email"] != nil) {
			t.Fatalf("support identity leaked or wrong: %v", mm)
		}
	}
	written := 0
	for _, m := range msgs {
		if m.(map[string]any)["side"] != "system" {
			written++
		}
	}
	if written != 2 {
		t.Fatalf("customer thread has %d written messages, want 2", written)
	}
	first := msgs[0].(map[string]any)
	atts := first["attachments"].([]any)
	if len(atts) != 1 {
		t.Fatalf("attachment missing: %v", first)
	}
	aid := atts[0].(map[string]any)["id"].(string)
	if code, a := call(customer.ID, orgID, h.Attachment, "GET", "/x", nil, "", gin.Params{{Key: "id", Value: id}, {Key: "aid", Value: aid}}); code != 200 || a["url"] == "" {
		t.Fatalf("attachment url: %d %v", code, a)
	}
	if _, u := call(customer.ID, orgID, h.UnreadForOrg, "GET", "/x", nil, "", nil); u["unread"].(float64) != 1 {
		t.Fatalf("reading the ticket should clear it, unread = %v", u["unread"])
	}

	// Another org can't see it.
	if code, _ := call(customer.ID, uuid.NewString(), h.Get, "GET", "/x", nil, "", p); code != 404 {
		t.Fatalf("cross-org read: %d", code)
	}

	// Resolve, then a customer reply reopens it; feedback is stored.
	call(agent.ID, "", h.UpdateStatus, "PATCH", "/x", jsonBody(map[string]any{"status": "resolved"}), "application/json", p)
	must(db.First(&tk, "id = ?", id).Error)
	if tk.Status != models.TicketStatusResolved || tk.ResolvedAt == nil {
		t.Fatalf("resolve: %s", tk.Status)
	}
	if code, _ := call(customer.ID, orgID, h.Feedback, "POST", "/x", jsonBody(map[string]any{"rating": 1, "comment": "Quick fix"}), "application/json", p); code != 200 {
		t.Fatalf("feedback: %d", code)
	}
	call(customer.ID, orgID, h.AddMessage, "POST", "/x", jsonBody(map[string]any{"body": "It came back after reboot"}), "application/json", p)
	must(db.First(&tk, "id = ?", id).Error)
	if tk.Status != models.TicketStatusOpen || tk.LastMessageSide != models.TicketSideCustomer || tk.Rating == nil || *tk.Rating != 1 {
		t.Fatalf("reopen: status=%s side=%s rating=%v", tk.Status, tk.LastMessageSide, tk.Rating)
	}

	// Superadmin list: needs-reply and unread counts, search by reference.
	_, list := call(agent.ID, "", h.List, "GET", "/x?view=needs_reply", nil, "", nil)
	if list["counts"].(map[string]any)["needs_reply"].(float64) < 1 || list["unread"].(float64) < 1 {
		t.Fatalf("superadmin counts: %v unread=%v", list["counts"], list["unread"])
	}
	_, found := call(agent.ID, "", h.List, "GET", "/x?q=DS-1002", nil, "", nil)
	if n := len(found["tickets"].([]any)); n != 1 {
		t.Fatalf("search by ref found %d", n)
	}

	// Thread has system entries for status changes.
	_, full := call(agent.ID, "", h.GetAny, "GET", "/x", nil, "", p)
	system := 0
	for _, m := range full["messages"].([]any) {
		if m.(map[string]any)["side"] == "system" {
			system++
		}
	}
	if system < 3 { // in progress, resolved, reopened
		t.Fatalf("system entries = %d", system)
	}
	_ = http.StatusOK
}

// TestTicketMailIntegration covers replies arriving by email (same opt-in DSN).
func TestTicketMailIntegration(t *testing.T) {
	dsn := os.Getenv("TICKETS_IT_DSN")
	if dsn == "" {
		t.Skip("TICKETS_IT_DSN not set")
	}
	t.Setenv("SCREENSHOT_R2_ENDPOINT", "")
	t.Setenv("SCREENSHOT_LOCAL_DIR", t.TempDir())
	t.Setenv("TICKET_MAIL_SECRET", "it-secret")
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
	must(db.Exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).Error)
	enums, _ := os.ReadFile("../../../../infra/postgres/init-enums.sql")
	must(db.Exec(string(enums)).Error)
	must(db.AutoMigrate(&models.Organization{}, &models.User{}, &models.AuditLog{}, &models.SupportTicket{},
		&models.SupportTicketMessage{}, &models.SupportTicketAttachment{}, &models.InboundEmail{}))
	must(database.MigrateSupportTickets(db))

	org := models.Organization{Name: "Delphic", Slug: "delphic"}
	other := models.Organization{Name: "Other", Slug: "other"}
	must(db.Create(&org).Error)
	must(db.Create(&other).Error)
	cust := models.User{OrgID: &org.ID, Email: "utsavi@delphic.in", FirstName: "Utsavi", PasswordHash: "x", Role: "org_admin"}
	colleague := models.User{OrgID: &org.ID, Email: "riya@delphic.in", FirstName: "Riya", PasswordHash: "x", Role: "analyst"}
	stranger := models.User{OrgID: &other.ID, Email: "x@other.com", FirstName: "X", PasswordHash: "x", Role: "org_admin"}
	agent := models.User{Email: "harshit@aavishailab.com", FirstName: "Harshit", PasswordHash: "x", Role: models.RoleSuperAdmin}
	for _, u := range []*models.User{&cust, &colleague, &stranger, &agent} {
		must(db.Create(u).Error)
	}
	h := NewTicketHandler(db)
	now := time.Now()
	tk := models.SupportTicket{OrgID: &org.ID, Subject: "Firewall", Status: models.TicketStatusResolved, CreatedByID: cust.ID,
		LastMessageAt: &now, LastMessageSide: models.TicketSideSupport}
	must(db.Create(&tk).Error)
	id := tk.ID.String()
	custThread := mailer.ThreadMessageID(id, "customer")
	teamThread := mailer.ThreadMessageID(id, "team")
	ctx := context.Background()

	in := func(msgID, from, refs, body string) inboundMail {
		return inboundMail{MessageID: msgID, From: from, References: "<x@gmail.com> " + refs, Text: body}
	}
	check := func(name string, m inboundMail, want string) {
		t.Helper()
		if got, _ := h.ingestEmail(ctx, m); got != want {
			t.Errorf("%s: got %q, want %q", name, got, want)
		}
	}

	// Ordinary mail in the shared inbox is untouched and not recorded.
	if res, ticket := h.ingestEmail(ctx, in("<n1@x>", "boss@delphic.in", "", "Lunch?")); ticket || res != "not a ticket reply" {
		t.Fatalf("plain mail: %q %v", res, ticket)
	}

	// Customer replies by email: added, ticket reopens.
	check("customer reply", in("<c1@gmail.com>", "utsavi@delphic.in", custThread,
		"It came back after a restart.\n\nOn Wed, Aavishield wrote:\n> Turn the firewall on"), "added")
	var got models.SupportTicket
	must(db.First(&got, "id = ?", id).Error)
	if got.Status != models.TicketStatusOpen || got.LastMessageSide != models.TicketSideCustomer {
		t.Fatalf("after customer email: status=%s side=%s", got.Status, got.LastMessageSide)
	}
	var last models.SupportTicketMessage
	must(db.Where("ticket_id = ? AND side = 'customer'", id).Order("created_at DESC").First(&last).Error)
	if last.Body != "It came back after a restart." || last.Source != "email" {
		t.Fatalf("stored reply: %q source=%s", last.Body, last.Source)
	}

	// Same email again (another poll, or it sat in two folders): once only.
	check("duplicate", in("<c1@gmail.com>", "utsavi@delphic.in", custThread, "It came back after a restart."), "already processed")
	// A colleague in the same company may join the thread.
	check("colleague", in("<c2@gmail.com>", "riya@delphic.in", custThread, "Same on my laptop."), "added")
	// Someone from another company can't write into it, even with the thread id.
	check("other org", in("<c3@x>", "x@other.com", custThread, "hi"), "ignored: sender is not in this ticket's organization")
	// An unknown address is refused.
	check("unknown", in("<c4@x>", "attacker@evil.com", custThread, "hi"), "ignored: sender is not a Aavishield user")
	// A customer can't post into the team thread.
	check("customer on team thread", in("<c5@x>", "utsavi@delphic.in", teamThread, "hi"), "ignored: sender is not on the Aavishield team")
	// A forged thread id is not a ticket reply at all.
	forged := strings.Replace(custThread, id, uuid.NewString(), 1)
	if res, ticket := h.ingestEmail(ctx, in("<c6@x>", "utsavi@delphic.in", forged, "hi")); ticket {
		t.Fatalf("forged id treated as ticket mail: %q", res)
	}
	// Out-of-office replies and our own mailbox are ignored.
	auto := in("<c7@x>", "utsavi@delphic.in", custThread, "I'm away")
	auto.AutoReply = true
	check("auto reply", auto, "ignored: automatic reply")
	check("quote only", in("<c8@x>", "utsavi@delphic.in", custThread, "On Wed, X wrote:\n> old"), "ignored: empty reply")

	// Support answers from their inbox: becomes a support reply, moves to in progress.
	check("support reply", in("<s1@x>", "harshit@aavishailab.com", teamThread, "Looking into it now."), "added")
	must(db.First(&got, "id = ?", id).Error)
	if got.LastMessageSide != models.TicketSideSupport || got.Status != models.TicketStatusInProgress || got.AssignedToID == nil {
		t.Fatalf("after support email: side=%s status=%s assigned=%v", got.LastMessageSide, got.Status, got.AssignedToID)
	}

	var recorded int64
	db.Model(&models.InboundEmail{}).Count(&recorded)
	if recorded != 8 { // each distinct email with a valid thread id; not plain, forged or repeat mail
		t.Fatalf("inbound_emails rows = %d", recorded)
	}
}
