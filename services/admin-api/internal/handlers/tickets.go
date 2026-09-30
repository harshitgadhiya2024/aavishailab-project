package handlers

import (
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/storage"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TicketHandler serves both sides of one support conversation: an org user
// raising and following a request (company routes, scoped to their org) and
// the Delsecure team answering every org's requests (superadmin routes).
//
// A ticket reads like an email thread: each message has a side (customer,
// support, system), support can leave internal notes the customer never
// sees, and every visible message is emailed to the other side with
// threading headers so the whole exchange lands in one email thread.
type TicketHandler struct {
	db    *gorm.DB
	store storage.Backend
}

func NewTicketHandler(db *gorm.DB) *TicketHandler {
	return &TicketHandler{db: db, store: storage.New()}
}

// ─── Vocabulary ───────────────────────────────────────────────────────────────

var ticketCategories = map[string]string{
	"agent":           "Agent & devices",
	"policies":        "Policies & blocking",
	"data_protection": "Data protection",
	"billing":         "Billing & plans",
	"account":         "Account & access",
	"other":           "Something else",
}

func categoryOf(s string) string {
	if _, ok := ticketCategories[s]; ok {
		return s
	}
	return "other"
}

func priorityOf(s string) models.TicketPriority {
	switch p := models.TicketPriority(s); p {
	case models.TicketPriorityLow, models.TicketPriorityHigh, models.TicketPriorityUrgent:
		return p
	}
	return models.TicketPriorityNormal
}

var statusLabels = map[models.TicketStatus]string{
	models.TicketStatusOpen:       "Open",
	models.TicketStatusInProgress: "In progress",
	models.TicketStatusResolved:   "Resolved",
	models.TicketStatusClosed:     "Closed",
}

func isDone(s models.TicketStatus) bool {
	return s == models.TicketStatusResolved || s == models.TicketStatusClosed
}

// ─── Attachments ──────────────────────────────────────────────────────────────

const (
	maxAttachments    = 5
	maxAttachmentSize = 10 << 20 // 10 MB
)

// allowedAttachments are the only file types accepted. Everything served
// back is a type a browser won't execute (no HTML, SVG or scripts), since
// files are served from the API's own domain.
var allowedAttachments = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
	".pdf": "application/pdf", ".txt": "text/plain", ".log": "text/plain", ".csv": "text/csv", ".zip": "application/zip",
}

func safeFileName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return '_'
		}
		return r
	}, name)
	if len(name) > 120 {
		ext := filepath.Ext(name)
		name = name[:120-len(ext)] + ext
	}
	if name == "" || name == "." {
		name = "file"
	}
	return name
}

// sniffOK rejects a file whose bytes don't match its extension family, so a
// renamed executable can't ride in as "photo.png".
func sniffOK(ext string, head []byte) bool {
	detected := http.DetectContentType(head)
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		return strings.HasPrefix(detected, "image/")
	case ".pdf":
		return detected == "application/pdf"
	case ".zip":
		return detected == "application/zip"
	default: // text formats
		return strings.HasPrefix(detected, "text/plain")
	}
}

type pendingFile struct {
	name, ext, contentType string
	data                   []byte
}

func readAttachments(files []*multipart.FileHeader) ([]pendingFile, string) {
	if len(files) > maxAttachments {
		return nil, fmt.Sprintf("Attach up to %d files", maxAttachments)
	}
	out := make([]pendingFile, 0, len(files))
	for _, fh := range files {
		name := safeFileName(fh.Filename)
		ext := strings.ToLower(filepath.Ext(name))
		ct, ok := allowedAttachments[ext]
		if !ok {
			return nil, name + ": only images, PDF, text, CSV, log and ZIP files can be attached"
		}
		if fh.Size > maxAttachmentSize {
			return nil, name + ": files must be 10 MB or smaller"
		}
		f, err := fh.Open()
		if err != nil {
			return nil, name + ": could not read the file"
		}
		data, err := io.ReadAll(io.LimitReader(f, maxAttachmentSize+1))
		f.Close()
		if err != nil || len(data) > maxAttachmentSize {
			return nil, name + ": files must be 10 MB or smaller"
		}
		head := data
		if len(head) > 512 {
			head = head[:512]
		}
		if len(data) == 0 || !sniffOK(ext, head) {
			return nil, name + ": the file's contents don't match its type"
		}
		out = append(out, pendingFile{name: name, ext: ext, contentType: ct, data: data})
	}
	return out, ""
}

func (h *TicketHandler) saveAttachments(ctx context.Context, ticketID, messageID uuid.UUID, files []pendingFile) {
	for _, f := range files {
		att := models.SupportTicketAttachment{ID: uuid.New(), TicketID: ticketID, MessageID: messageID, FileName: f.name, ContentType: f.contentType, Size: int64(len(f.data))}
		// The key ends in the vetted extension, which is what the media
		// route derives the served Content-Type from.
		att.StorageKey = fmt.Sprintf("support/%s/%s%s", ticketID, att.ID, f.ext)
		if err := h.store.Put(ctx, att.StorageKey, f.contentType, f.data); err != nil {
			continue
		}
		h.db.Create(&att)
	}
}

// messageInput reads a message from either multipart form (with files) or
// JSON, so the same endpoint serves plain replies and replies with files.
type messageInput struct {
	Subject  string
	Body     string
	Category string
	Priority string
	Internal bool
	Status   string
	Files    []pendingFile
}

func bindMessage(c *gin.Context) (messageInput, string) {
	var in messageInput
	if strings.HasPrefix(c.ContentType(), "multipart/") {
		if err := c.Request.ParseMultipartForm(maxAttachments*maxAttachmentSize + (1 << 20)); err != nil {
			return in, "Could not read the upload"
		}
		f := c.Request.MultipartForm
		get := func(k string) string {
			if v := f.Value[k]; len(v) > 0 {
				return v[0]
			}
			return ""
		}
		in = messageInput{Subject: get("subject"), Body: get("body"), Category: get("category"), Priority: get("priority"),
			Internal: get("internal") == "true", Status: get("status")}
		files, errMsg := readAttachments(f.File["files"])
		if errMsg != "" {
			return in, errMsg
		}
		in.Files = files
	} else {
		var j struct {
			Subject, Body, Category, Priority, Status string
			Internal                                  bool
		}
		if err := c.ShouldBindJSON(&j); err != nil {
			return in, "Invalid request"
		}
		in = messageInput{Subject: j.Subject, Body: j.Body, Category: j.Category, Priority: j.Priority, Internal: j.Internal, Status: j.Status}
	}
	in.Subject = strings.TrimSpace(in.Subject)
	in.Body = strings.TrimSpace(in.Body)
	if len(in.Body) > 20000 {
		in.Body = in.Body[:20000]
	}
	if len(in.Subject) > 200 {
		in.Subject = in.Subject[:200]
	}
	return in, ""
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

func (h *TicketHandler) userName(id uuid.UUID) (name, email string) {
	var u models.User
	if h.db.Select("first_name", "last_name", "email").First(&u, "id = ?", id).Error != nil {
		return "", ""
	}
	name = strings.TrimSpace(strings.TrimSpace(u.FirstName) + " " + strings.TrimSpace(u.LastName))
	if name == "" {
		name = u.Email
	}
	return name, u.Email
}

func firstName(full string) string {
	if i := strings.IndexByte(full, ' '); i > 0 {
		return full[:i]
	}
	return full
}

func (h *TicketHandler) mailInfo(t *models.SupportTicket, forCustomer bool) mailer.TicketMail {
	org := "Delsecure"
	if t.OrgID != nil {
		var o models.Organization
		if h.db.Select("name").First(&o, "id = ?", *t.OrgID).Error == nil {
			org = o.Name
		}
	}
	link := mailer.Settings().SuperadminURL + "/dashboard/tickets?id=" + t.ID.String()
	if forCustomer {
		link = mailer.Settings().AppURL + "/dashboard/support/" + t.ID.String()
	}
	return mailer.TicketMail{
		TicketID: t.ID.String(), Ref: mailer.TicketRef(t.Number), Subject: t.Subject, OrgName: org,
		Category: ticketCategories[categoryOf(t.Category)], Priority: mailer.Titleish(string(t.Priority)), Link: link,
	}
}

// customerRecipients is everyone on the org side of the conversation: the
// person who raised it plus anyone from the org who has replied.
func (h *TicketHandler) customerRecipients(t *models.SupportTicket) []string {
	var emails []string
	h.db.Raw(`SELECT DISTINCT u.email FROM users u
		WHERE u.id = ? OR u.id IN (SELECT author_id FROM support_ticket_messages WHERE ticket_id = ? AND side = 'customer')`,
		t.CreatedByID, t.ID).Scan(&emails)
	return emails
}

// teamRecipients is the whole Delsecure team: every active superadmin, plus
// any extra addresses in SUPPORT_NOTIFY_EMAIL (e.g. a shared support inbox).
func (h *TicketHandler) teamRecipients(_ *models.SupportTicket) []string {
	var emails []string
	h.db.Model(&models.User{}).
		Where("role = ? AND status = ?", models.RoleSuperAdmin, models.StatusActive).
		Pluck("email", &emails)
	if extra := os.Getenv("SUPPORT_NOTIFY_EMAIL"); extra != "" {
		emails = append(emails, strings.Split(extra, ",")...)
	}
	return emails
}

func (h *TicketHandler) systemNote(ticketID, author uuid.UUID, body string) {
	h.db.Create(&models.SupportTicketMessage{TicketID: ticketID, AuthorID: author, Side: models.TicketSideSystem, Body: body})
}

// loadTicket fetches a ticket, restricted to the caller's org on the company
// side (scopedOrgID != "") and unrestricted for superadmins.
func (h *TicketHandler) loadTicket(c *gin.Context, scopedOrgID string) (*models.SupportTicket, bool) {
	var t models.SupportTicket
	q := h.db.Where("id = ?", c.Param("id"))
	if scopedOrgID != "" {
		q = q.Where("org_id = ?", scopedOrgID)
	}
	if err := q.First(&t).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request not found"})
		return nil, false
	}
	return &t, true
}

// ─── Lists ────────────────────────────────────────────────────────────────────

type ticketRow struct {
	models.SupportTicket
	Ref          string `json:"ref"`
	CategoryName string `json:"category_name"`
	OrgName      string `json:"org_name,omitempty"`
	CreatedBy    string `json:"created_by"`
	CreatedEmail string `json:"created_by_email"`
	AssignedTo   string `json:"assigned_to,omitempty"`
	Preview      string `json:"preview"`
	MessageCount int64  `json:"message_count"`
	Unread       bool   `json:"unread"`
}

func (h *TicketHandler) rows(tickets []models.SupportTicket, forSupport bool) []ticketRow {
	out := make([]ticketRow, 0, len(tickets))
	for _, t := range tickets {
		r := ticketRow{SupportTicket: t, Ref: mailer.TicketRef(t.Number), CategoryName: ticketCategories[categoryOf(t.Category)]}
		r.CreatedBy, r.CreatedEmail = h.userName(t.CreatedByID)
		if t.AssignedToID != nil {
			r.AssignedTo, _ = h.userName(*t.AssignedToID)
		}
		if forSupport && t.OrgID != nil {
			var o models.Organization
			if h.db.Select("name").First(&o, "id = ?", *t.OrgID).Error == nil {
				r.OrgName = o.Name
			}
		}
		var last models.SupportTicketMessage
		q := h.db.Where("ticket_id = ? AND side <> 'system'", t.ID)
		if !forSupport {
			q = q.Where("internal = false")
		}
		if q.Order("created_at DESC").First(&last).Error == nil {
			r.Preview = last.Body
			if len(r.Preview) > 160 {
				r.Preview = r.Preview[:160] + "…"
			}
		}
		cq := h.db.Model(&models.SupportTicketMessage{}).Where("ticket_id = ? AND side <> 'system'", t.ID)
		if !forSupport {
			cq = cq.Where("internal = false")
		}
		cq.Count(&r.MessageCount)
		if t.LastMessageAt != nil {
			if forSupport {
				r.Unread = t.LastMessageSide == models.TicketSideCustomer && (t.SupportReadAt == nil || t.SupportReadAt.Before(*t.LastMessageAt))
			} else {
				r.Unread = t.LastMessageSide == models.TicketSideSupport && (t.CustomerReadAt == nil || t.CustomerReadAt.Before(*t.LastMessageAt))
			}
		}
		out = append(out, r)
	}
	return out
}

// customerUnreadSQL / supportUnreadSQL: the other side wrote last and this
// side hasn't opened the ticket since.
const (
	customerUnreadSQL = `last_message_side = 'support' AND (customer_read_at IS NULL OR customer_read_at < last_message_at)`
	supportUnreadSQL  = `last_message_side = 'customer' AND (support_read_at IS NULL OR support_read_at < last_message_at)`
)

// ListForOrg handles GET /tickets?view=open|waiting|resolved|all
func (h *TicketHandler) ListForOrg(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	base := func() *gorm.DB { return h.db.Model(&models.SupportTicket{}).Where("org_id = ?", orgID) }

	counts := gin.H{}
	var n int64
	base().Where("status IN ?", []string{"open", "in_progress"}).Count(&n)
	counts["open"] = n
	base().Where("status IN ? AND last_message_side = 'support'", []string{"open", "in_progress"}).Count(&n)
	counts["waiting"] = n
	base().Where("status IN ?", []string{"resolved", "closed"}).Count(&n)
	counts["resolved"] = n
	base().Count(&n)
	counts["all"] = n
	var unread int64
	base().Where(customerUnreadSQL).Count(&unread)

	q := base()
	switch c.Query("view") {
	case "open":
		q = q.Where("status IN ?", []string{"open", "in_progress"})
	case "waiting":
		q = q.Where("status IN ? AND last_message_side = 'support'", []string{"open", "in_progress"})
	case "resolved":
		q = q.Where("status IN ?", []string{"resolved", "closed"})
	}
	var tickets []models.SupportTicket
	q.Order("COALESCE(last_message_at, created_at) DESC").Limit(200).Find(&tickets)
	c.JSON(http.StatusOK, gin.H{"tickets": h.rows(tickets, false), "counts": counts, "unread": unread})
}

// UnreadForOrg handles GET /tickets/unread — the header badge.
func (h *TicketHandler) UnreadForOrg(c *gin.Context) {
	var n int64
	h.db.Model(&models.SupportTicket{}).Where("org_id = ?", c.GetString("scoped_org_id")).Where(customerUnreadSQL).Count(&n)
	c.JSON(http.StatusOK, gin.H{"unread": n})
}

// List handles GET /superadmin/tickets?view=&q=&org_id=&priority=&assigned=
func (h *TicketHandler) List(c *gin.Context) {
	uid := currentUserID(c)
	base := func() *gorm.DB { return h.db.Model(&models.SupportTicket{}) }

	counts := gin.H{}
	var n int64
	base().Where("status IN ? AND (last_message_side = 'customer' OR last_message_side IS NULL OR last_message_side = '')", []string{"open", "in_progress"}).Count(&n)
	counts["needs_reply"] = n
	base().Where("status IN ?", []string{"open", "in_progress"}).Count(&n)
	counts["open"] = n
	if uid != nil {
		base().Where("assigned_to_id = ? AND status IN ?", *uid, []string{"open", "in_progress"}).Count(&n)
		counts["mine"] = n
	}
	base().Where("status IN ?", []string{"resolved", "closed"}).Count(&n)
	counts["resolved"] = n
	base().Count(&n)
	counts["all"] = n
	var unread int64
	base().Where(supportUnreadSQL).Count(&unread)

	q := base()
	switch c.Query("view") {
	case "needs_reply":
		q = q.Where("status IN ? AND (last_message_side = 'customer' OR last_message_side IS NULL OR last_message_side = '')", []string{"open", "in_progress"})
	case "open":
		q = q.Where("status IN ?", []string{"open", "in_progress"})
	case "mine":
		if uid != nil {
			q = q.Where("assigned_to_id = ? AND status IN ?", *uid, []string{"open", "in_progress"})
		}
	case "resolved":
		q = q.Where("status IN ?", []string{"resolved", "closed"})
	}
	if org := c.Query("org_id"); org != "" {
		q = q.Where("org_id = ?", org)
	}
	if p := c.Query("priority"); p != "" {
		q = q.Where("priority = ?", p)
	}
	if term := strings.TrimSpace(c.Query("q")); term != "" {
		num := strings.TrimPrefix(strings.ToUpper(term), "DS-")
		if _, err := strconv.ParseInt(num, 10, 64); err == nil {
			q = q.Where("number = ?", num)
		} else {
			like := "%" + strings.ToLower(term) + "%"
			q = q.Where(`LOWER(subject) LIKE ? OR org_id IN (SELECT id FROM organizations WHERE LOWER(name) LIKE ?)`, like, like)
		}
	}
	var tickets []models.SupportTicket
	// Urgent work first, then whatever moved most recently.
	q.Order(`CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`).
		Order("COALESCE(last_message_at, created_at) DESC").Limit(300).Find(&tickets)
	c.JSON(http.StatusOK, gin.H{"tickets": h.rows(tickets, true), "counts": counts, "unread": unread})
}

// ─── Create ───────────────────────────────────────────────────────────────────

// Create handles POST /tickets (company-dashboard). The org comes from the
// caller's JWT scope, never the request body.
func (h *TicketHandler) Create(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "No organization context"})
		return
	}
	h.create(c, &orgID)
}

// CreateInternal handles POST /superadmin/tickets — a platform-level ticket
// for internal tracking (no org).
func (h *TicketHandler) CreateInternal(c *gin.Context) { h.create(c, nil) }

func (h *TicketHandler) create(c *gin.Context, orgID *uuid.UUID) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Could not identify the signed-in user"})
		return
	}
	in, errMsg := bindMessage(c)
	if errMsg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
		return
	}
	if in.Subject == "" || in.Body == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Add a subject and describe the problem"})
		return
	}

	now := time.Now()
	side := models.TicketSideCustomer
	if orgID == nil {
		side = models.TicketSideSupport
	}
	t := models.SupportTicket{
		OrgID: orgID, Subject: in.Subject, Category: categoryOf(in.Category), Status: models.TicketStatusOpen,
		Priority: priorityOf(in.Priority), CreatedByID: *uid,
		LastMessageAt: &now, LastMessageSide: side, CustomerReadAt: &now,
	}
	var msg models.SupportTicketMessage
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&t).Error; err != nil {
			return err
		}
		msg = models.SupportTicketMessage{TicketID: t.ID, AuthorID: *uid, Side: side, Body: in.Body}
		return tx.Create(&msg).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create the request"})
		return
	}
	h.db.First(&t, "id = ?", t.ID) // pick up the sequence-assigned number
	h.saveAttachments(c.Request.Context(), t.ID, msg.ID, in.Files)

	if orgID != nil {
		name, _ := h.userName(*uid)
		mailer.TicketOpenedTeam(h.teamRecipients(&t), h.mailInfo(&t, false), name, in.Body, len(in.Files))
		mailer.TicketOpenedCustomer(h.customerRecipients(&t), h.mailInfo(&t, true), firstName(name), in.Body)
	}
	writeAudit(h.db, c, orgID, "create", "support_ticket", &t.ID, map[string]any{"subject": t.Subject, "ref": mailer.TicketRef(t.Number)})
	c.JSON(http.StatusCreated, gin.H{"id": t.ID, "number": t.Number, "ref": mailer.TicketRef(t.Number)})
}

// ─── Detail ───────────────────────────────────────────────────────────────────

type threadAttachment struct {
	ID          uuid.UUID `json:"id"`
	FileName    string    `json:"file_name"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
}

type threadMessage struct {
	ID          uuid.UUID          `json:"id"`
	Side        string             `json:"side"`
	Internal    bool               `json:"internal"`
	Source      string             `json:"source"`
	Body        string             `json:"body"`
	CreatedAt   time.Time          `json:"created_at"`
	AuthorName  string             `json:"author_name"`
	AuthorEmail string             `json:"author_email,omitempty"`
	Attachments []threadAttachment `json:"attachments"`
}

func (h *TicketHandler) detail(c *gin.Context, scopedOrgID string, forSupport bool) {
	t, ok := h.loadTicket(c, scopedOrgID)
	if !ok {
		return
	}
	var msgs []models.SupportTicketMessage
	q := h.db.Where("ticket_id = ?", t.ID)
	if !forSupport {
		q = q.Where("internal = false")
	}
	q.Order("created_at ASC").Find(&msgs)

	var atts []models.SupportTicketAttachment
	h.db.Where("ticket_id = ?", t.ID).Order("created_at ASC").Find(&atts)
	byMsg := map[uuid.UUID][]threadAttachment{}
	for _, a := range atts {
		byMsg[a.MessageID] = append(byMsg[a.MessageID], threadAttachment{a.ID, a.FileName, a.ContentType, a.Size})
	}

	names := map[uuid.UUID][2]string{}
	out := make([]threadMessage, 0, len(msgs))
	for _, m := range msgs {
		n, ok := names[m.AuthorID]
		if !ok {
			name, email := h.userName(m.AuthorID)
			n = [2]string{name, email}
			names[m.AuthorID] = n
		}
		tm := threadMessage{ID: m.ID, Side: m.Side, Internal: m.Internal, Source: m.Source, Body: m.Body, CreatedAt: m.CreatedAt,
			AuthorName: n[0], Attachments: byMsg[m.ID]}
		if tm.Attachments == nil {
			tm.Attachments = []threadAttachment{}
		}
		// Customers see support staff by first name only, the way a support
		// desk signs its replies; support sees full identities.
		if forSupport || m.Side == models.TicketSideCustomer {
			tm.AuthorEmail = n[1]
		} else {
			tm.AuthorName = firstName(n[0])
		}
		out = append(out, tm)
	}

	now := time.Now()
	if forSupport {
		h.db.Model(t).UpdateColumn("support_read_at", now)
	} else {
		h.db.Model(t).UpdateColumn("customer_read_at", now)
	}

	row := h.rows([]models.SupportTicket{*t}, forSupport)[0]
	c.JSON(http.StatusOK, gin.H{"ticket": row, "messages": out})
}

// Get handles GET /tickets/:id (company, own org, no internal notes).
func (h *TicketHandler) Get(c *gin.Context) { h.detail(c, c.GetString("scoped_org_id"), false) }

// GetAny handles GET /superadmin/tickets/:id.
func (h *TicketHandler) GetAny(c *gin.Context) { h.detail(c, "", true) }

// ─── Replies ──────────────────────────────────────────────────────────────────

// AddMessage handles POST /tickets/:id/messages — the customer replies. A
// reply to a resolved request reopens it.
func (h *TicketHandler) AddMessage(c *gin.Context) {
	t, ok := h.loadTicket(c, c.GetString("scoped_org_id"))
	if !ok {
		return
	}
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Could not identify the signed-in user"})
		return
	}
	in, errMsg := bindMessage(c)
	if errMsg != "" || in.Body == "" {
		if errMsg == "" {
			errMsg = "Write a message"
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
		return
	}
	msg, err := h.customerReply(c.Request.Context(), t, *uid, in, "web")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": msg.ID})
}

// customerReply adds an org user's message (from the dashboard or by email),
// reopening a resolved ticket and emailing the team.
func (h *TicketHandler) customerReply(ctx context.Context, t *models.SupportTicket, uid uuid.UUID, in messageInput, source string) (*models.SupportTicketMessage, error) {
	name, _ := h.userName(uid)
	if isDone(t.Status) {
		h.systemNote(t.ID, uid, "Reopened by "+name)
		h.db.Model(t).Updates(map[string]any{"status": models.TicketStatusOpen, "resolved_at": nil})
		t.Status = models.TicketStatusOpen
	}
	msg := models.SupportTicketMessage{TicketID: t.ID, AuthorID: uid, Side: models.TicketSideCustomer, Source: source, Body: in.Body}
	if err := h.db.Create(&msg).Error; err != nil {
		return nil, err
	}
	h.saveAttachments(ctx, t.ID, msg.ID, in.Files)
	now := time.Now()
	h.db.Model(t).Updates(map[string]any{"last_message_at": now, "last_message_side": models.TicketSideCustomer, "customer_read_at": now})
	mailer.TicketReplyToTeam(h.teamRecipients(t), h.mailInfo(t, false), name, in.Body, len(in.Files))
	return &msg, nil
}

// AddMessageAny handles POST /superadmin/tickets/:id/messages — a support
// reply (emailed to the customer) or an internal note (never shown to them).
// Form field "status" optionally moves the ticket in the same step.
func (h *TicketHandler) AddMessageAny(c *gin.Context) {
	t, ok := h.loadTicket(c, "")
	if !ok {
		return
	}
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Could not identify the signed-in user"})
		return
	}
	in, errMsg := bindMessage(c)
	if errMsg != "" || in.Body == "" {
		if errMsg == "" {
			errMsg = "Write a message"
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
		return
	}
	msg, err := h.supportReply(c.Request.Context(), t, *uid, in, "web")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": msg.ID})
}

// supportReply adds a superadmin's reply or internal note (from the console
// or by email). A reply moves an open ticket to in progress, takes ownership
// if nobody has it, and is emailed to the customer.
func (h *TicketHandler) supportReply(ctx context.Context, t *models.SupportTicket, uid uuid.UUID, in messageInput, source string) (*models.SupportTicketMessage, error) {
	msg := models.SupportTicketMessage{TicketID: t.ID, AuthorID: uid, Side: models.TicketSideSupport, Internal: in.Internal, Source: source, Body: in.Body}
	if err := h.db.Create(&msg).Error; err != nil {
		return nil, err
	}
	h.saveAttachments(ctx, t.ID, msg.ID, in.Files)
	now := time.Now()
	updates := map[string]any{"support_read_at": now}
	if !in.Internal {
		updates["last_message_at"] = now
		updates["last_message_side"] = models.TicketSideSupport
		if t.Status == models.TicketStatusOpen && in.Status == "" {
			in.Status = string(models.TicketStatusInProgress)
		}
		if t.AssignedToID == nil {
			updates["assigned_to_id"] = uid
		}
	}
	h.db.Model(t).Updates(updates)
	if !in.Internal && t.OrgID != nil {
		name, _ := h.userName(uid)
		mailer.TicketReplyToCustomer(h.customerRecipients(t), h.mailInfo(t, true), firstName(name)+" from Delsecure Support", in.Body, len(in.Files))
	}
	if in.Status != "" {
		h.setStatus(t, uid, models.TicketStatus(in.Status))
	}
	return &msg, nil
}

// setStatus changes status, records it in the thread and, on resolve, tells
// the customer.
func (h *TicketHandler) setStatus(t *models.SupportTicket, by uuid.UUID, to models.TicketStatus) bool {
	if _, ok := statusLabels[to]; !ok || to == t.Status {
		return false
	}
	updates := map[string]any{"status": to}
	if isDone(to) {
		updates["resolved_at"] = time.Now()
	} else {
		updates["resolved_at"] = nil
	}
	h.db.Model(t).Updates(updates)
	name, _ := h.userName(by)
	h.systemNote(t.ID, by, fmt.Sprintf("Status changed to %s by %s", statusLabels[to], firstName(name)))
	if to == models.TicketStatusResolved && t.OrgID != nil {
		var creator string
		creator, _ = h.userName(t.CreatedByID)
		mailer.TicketResolvedCustomer(h.customerRecipients(t), h.mailInfo(t, true), firstName(creator))
	}
	t.Status = to
	return true
}

// ─── Customer actions ─────────────────────────────────────────────────────────

// Resolve handles POST /tickets/:id/resolve — the customer says it's fixed.
func (h *TicketHandler) Resolve(c *gin.Context) {
	t, ok := h.loadTicket(c, c.GetString("scoped_org_id"))
	if !ok {
		return
	}
	uid := currentUserID(c)
	if uid == nil || isDone(t.Status) {
		c.JSON(http.StatusOK, gin.H{"status": t.Status})
		return
	}
	name, _ := h.userName(*uid)
	h.db.Model(t).Updates(map[string]any{"status": models.TicketStatusResolved, "resolved_at": time.Now()})
	h.systemNote(t.ID, *uid, "Marked as resolved by "+name)
	c.JSON(http.StatusOK, gin.H{"status": models.TicketStatusResolved})
}

// Feedback handles POST /tickets/:id/feedback {rating: 1 | -1, comment}.
func (h *TicketHandler) Feedback(c *gin.Context) {
	t, ok := h.loadTicket(c, c.GetString("scoped_org_id"))
	if !ok {
		return
	}
	var req struct {
		Rating  int    `json:"rating"`
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || (req.Rating != 1 && req.Rating != -1) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Rating must be 1 or -1"})
		return
	}
	if len(req.Comment) > 2000 {
		req.Comment = req.Comment[:2000]
	}
	h.db.Model(t).Updates(map[string]any{"rating": req.Rating, "rating_comment": strings.TrimSpace(req.Comment)})
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Superadmin triage ────────────────────────────────────────────────────────

// UpdateStatus handles PATCH /superadmin/tickets/:id — status, priority,
// assignee. Each change is written into the thread.
func (h *TicketHandler) UpdateStatus(c *gin.Context) {
	t, ok := h.loadTicket(c, "")
	if !ok {
		return
	}
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Could not identify the signed-in user"})
		return
	}
	var req struct {
		Status       string  `json:"status"`
		Priority     string  `json:"priority"`
		AssignedToID *string `json:"assigned_to_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	changes := map[string]any{}
	name, _ := h.userName(*uid)
	if req.Status != "" && h.setStatus(t, *uid, models.TicketStatus(req.Status)) {
		changes["status"] = req.Status
	}
	if req.Priority != "" {
		if p := priorityOf(req.Priority); p != t.Priority {
			h.db.Model(t).Update("priority", p)
			h.systemNote(t.ID, *uid, fmt.Sprintf("Priority set to %s by %s", mailer.Titleish(string(p)), firstName(name)))
			changes["priority"] = p
		}
	}
	if req.AssignedToID != nil {
		if *req.AssignedToID == "" {
			h.db.Model(t).Update("assigned_to_id", nil)
			changes["assigned_to_id"] = nil
		} else if id, err := uuid.Parse(*req.AssignedToID); err == nil {
			var u models.User
			if h.db.Where("id = ? AND role = ?", id, models.RoleSuperAdmin).First(&u).Error == nil {
				h.db.Model(t).Update("assigned_to_id", id)
				who, _ := h.userName(id)
				h.systemNote(t.ID, *uid, fmt.Sprintf("Assigned to %s by %s", firstName(who), firstName(name)))
				changes["assigned_to_id"] = id
			}
		}
	}
	writeAudit(h.db, c, t.OrgID, "update", "support_ticket", &t.ID, changes)
	c.JSON(http.StatusOK, gin.H{"ok": true, "changes": changes})
}

// ─── Attachments ──────────────────────────────────────────────────────────────

func (h *TicketHandler) attachment(c *gin.Context, scopedOrgID string, forSupport bool) {
	t, ok := h.loadTicket(c, scopedOrgID)
	if !ok {
		return
	}
	var a models.SupportTicketAttachment
	if err := h.db.Where("id = ? AND ticket_id = ?", c.Param("aid"), t.ID).First(&a).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}
	if !forSupport {
		// Files on an internal note stay internal.
		var m models.SupportTicketMessage
		if h.db.Select("internal").First(&m, "id = ?", a.MessageID).Error != nil || m.Internal {
			c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
			return
		}
	}
	url, err := h.store.SignedURL(a.StorageKey, 10*time.Minute)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not open the file"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": url, "file_name": a.FileName})
}

// Attachment handles GET /tickets/:id/attachments/:aid → short-lived URL.
func (h *TicketHandler) Attachment(c *gin.Context) {
	h.attachment(c, c.GetString("scoped_org_id"), false)
}

// AttachmentAny handles GET /superadmin/tickets/:id/attachments/:aid.
func (h *TicketHandler) AttachmentAny(c *gin.Context) { h.attachment(c, "", true) }
