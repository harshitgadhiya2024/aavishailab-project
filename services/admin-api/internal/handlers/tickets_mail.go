package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"io"
	"log"
	"net"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/emersion/go-imap"
	imapclient "github.com/emersion/go-imap/client"
	_ "github.com/emersion/go-message/charset" // decode non-UTF-8 mail (Outlook, older clients)
	gomail "github.com/emersion/go-message/mail"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Replies by email.
//
// Every ticket email goes out from the support mailbox with a signed thread
// Message-ID (see mailer.ThreadMessageID). A background poller reads that
// mailbox over IMAP and, for each message whose In-Reply-To / References
// carries a valid signature, adds the reply to the ticket as if it had been
// typed in the dashboard. The mailbox is also the company's general inbox, so
// the poller only ever reads (EXAMINE + BODY.PEEK): it never marks, moves or
// deletes anything, and mail that isn't a ticket reply is left alone.

// ─── Parsed message ───────────────────────────────────────────────────────────

type inboundMail struct {
	MessageID   string
	From        string
	Subject     string
	InReplyTo   string
	References  string
	AutoReply   bool   // Auto-Submitted / Precedence / X-Autoreply said so
	DMARCFailed bool   // the receiving server saw a DMARC failure
	Text        string // plain-text body (HTML converted when that's all there is)
	Files       []rawFile
}

type rawFile struct {
	Name string
	Data []byte
}

var (
	tagRe   = regexp.MustCompile(`(?s)<[^>]*>`)
	styleRe = regexp.MustCompile(`(?is)<(style|script|head)[^>]*>.*?</(style|script|head)>`)
	brRe    = regexp.MustCompile(`(?i)<br\s*/?>|</(p|div|tr|li|h[1-6])>`)
)

func htmlToText(s string) string {
	s = styleRe.ReplaceAllString(s, "")
	s = brRe.ReplaceAllString(s, "\n")
	s = tagRe.ReplaceAllString(s, "")
	return html.UnescapeString(s)
}

// parseMail reads a raw RFC 5322 message into what the ticket system needs.
func parseMail(raw []byte) (inboundMail, error) {
	var m inboundMail
	r, err := gomail.CreateReader(bytes.NewReader(raw))
	if err != nil && r == nil {
		return m, err
	}
	hd := r.Header
	m.MessageID = strings.TrimSpace(hd.Get("Message-Id"))
	m.Subject, _ = hd.Subject()
	m.InReplyTo = hd.Get("In-Reply-To")
	m.References = hd.Get("References")
	if from, err := hd.AddressList("From"); err == nil && len(from) > 0 {
		m.From = strings.ToLower(strings.TrimSpace(from[0].Address))
	}
	if as := strings.ToLower(hd.Get("Auto-Submitted")); as != "" && as != "no" {
		m.AutoReply = true
	}
	switch strings.ToLower(hd.Get("Precedence")) {
	case "bulk", "junk", "list", "auto_reply":
		m.AutoReply = true
	}
	if hd.Get("X-Autoreply") != "" || hd.Get("X-Autorespond") != "" {
		m.AutoReply = true
	}
	if strings.Contains(strings.ToLower(hd.Get("Authentication-Results")), "dmarc=fail") {
		m.DMARCFailed = true
	}

	var plain, htmlBody string
	for {
		p, err := r.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		switch h := p.Header.(type) {
		case *gomail.InlineHeader:
			ct, _, _ := h.ContentType()
			b, _ := io.ReadAll(io.LimitReader(p.Body, 2<<20))
			if ct == "text/plain" && plain == "" {
				plain = string(b)
			} else if ct == "text/html" && htmlBody == "" {
				htmlBody = string(b)
			}
		case *gomail.AttachmentHeader:
			name, _ := h.Filename()
			b, _ := io.ReadAll(io.LimitReader(p.Body, maxAttachmentSize+1))
			if name != "" && len(m.Files) < maxAttachments {
				m.Files = append(m.Files, rawFile{Name: name, Data: b})
			}
		}
	}
	m.Text = plain
	if m.Text == "" {
		m.Text = htmlToText(htmlBody)
	}
	return m, nil
}

// ─── Quote stripping ──────────────────────────────────────────────────────────

var quoteStarts = []*regexp.Regexp{
	regexp.MustCompile(`(?m)^[ \t>]*` + regexp.QuoteMeta(mailer.ReplyMarker)),
	// Gmail / Apple Mail: "On Wed, 30 Sep 2026 at 17:24, Delsecure <x@y> wrote:" (may wrap)
	regexp.MustCompile(`(?m)^On [^\n]{0,300}(\n[^\n]{0,300})?wrote:[ \t]*$`),
	regexp.MustCompile(`(?mi)^-{2,}\s*Original Message\s*-{2,}`),
	regexp.MustCompile(`(?mi)^-{2,}\s*Forwarded message\s*-{2,}`),
	regexp.MustCompile(`(?m)^_{10,}[ \t]*$`), // Outlook separator
	regexp.MustCompile(`(?mi)^From:[^\n]+\n(Sent|Date):`),
}

// extractReply keeps only what the person wrote above the quoted email.
func extractReply(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	cut := len(text)
	for _, re := range quoteStarts {
		if loc := re.FindStringIndex(text); loc != nil && loc[0] < cut {
			cut = loc[0]
		}
	}
	lines := strings.Split(text[:cut], "\n")
	// Drop any quoted lines left at the end ("> ..."), then blank tail.
	for len(lines) > 0 {
		l := strings.TrimSpace(lines[len(lines)-1])
		if l == "" || strings.HasPrefix(l, ">") {
			lines = lines[:len(lines)-1]
			continue
		}
		break
	}
	out := strings.TrimSpace(strings.Join(lines, "\n"))
	if len(out) > 20000 {
		out = out[:20000]
	}
	return out
}

// emailAttachments runs email attachments through the same checks as uploads;
// a file that fails is dropped rather than rejecting the whole reply.
func emailAttachments(files []rawFile) (ok []pendingFile, dropped []string) {
	for _, f := range files {
		name := safeFileName(f.Name)
		ext := strings.ToLower(filepath.Ext(name))
		ct, allowed := allowedAttachments[ext]
		head := f.Data
		if len(head) > 512 {
			head = head[:512]
		}
		if !allowed || len(f.Data) == 0 || len(f.Data) > maxAttachmentSize || !sniffOK(ext, head) || len(ok) >= maxAttachments {
			dropped = append(dropped, name)
			continue
		}
		ok = append(ok, pendingFile{name: name, ext: ext, contentType: ct, data: f.Data})
	}
	return ok, dropped
}

// ─── Ingestion ────────────────────────────────────────────────────────────────

// ingestEmail adds one inbound email to its ticket, or explains why not.
// isTicketMail is false for ordinary mail in the shared inbox, which is not
// recorded at all.
func (h *TicketHandler) ingestEmail(ctx context.Context, m inboundMail) (result string, isTicketMail bool) {
	ticketID, side, ok := mailer.ParseThreadID(m.InReplyTo, m.References)
	if !ok {
		return "not a ticket reply", false
	}
	if m.MessageID == "" {
		sum := sha256.Sum256([]byte(m.From + "|" + m.Subject + "|" + m.Text))
		m.MessageID = "<sha-" + hex.EncodeToString(sum[:12]) + "@inbound>"
	}
	var seen int64
	h.db.Model(&models.InboundEmail{}).Where("message_id = ?", m.MessageID).Count(&seen)
	if seen > 0 {
		return "already processed", true
	}

	tid, _ := uuid.Parse(ticketID)
	record := func(res string) string {
		h.db.Create(&models.InboundEmail{MessageID: m.MessageID, FromAddr: m.From, TicketID: &tid, Result: res})
		return res
	}

	switch {
	case strings.EqualFold(m.From, mailer.Settings().FromEmail):
		return record("ignored: sent by our own mailbox"), true
	case m.AutoReply:
		return record("ignored: automatic reply"), true
	case m.DMARCFailed:
		return record("ignored: sender failed DMARC"), true
	}

	var t models.SupportTicket
	if err := h.db.First(&t, "id = ?", tid).Error; err != nil {
		return record("ignored: ticket not found"), true
	}
	var u models.User
	if err := h.db.Where("LOWER(email) = ? AND status = ?", m.From, models.StatusActive).First(&u).Error; err != nil {
		return record("ignored: sender is not a Delsecure user"), true
	}
	// The thread a reply belongs to decides who may write into it.
	if side == "customer" && (t.OrgID == nil || u.OrgID == nil || *u.OrgID != *t.OrgID) {
		return record("ignored: sender is not in this ticket's organization"), true
	}
	if side == "team" && u.Role != models.RoleSuperAdmin {
		return record("ignored: sender is not on the Delsecure team"), true
	}

	body := extractReply(m.Text)
	files, dropped := emailAttachments(m.Files)
	if len(dropped) > 0 {
		body = strings.TrimSpace(body + "\n\n(Not attached, unsupported or too large: " + strings.Join(dropped, ", ") + ")")
	}
	if body == "" && len(files) == 0 {
		return record("ignored: empty reply"), true
	}
	if body == "" {
		body = "(Sent attachments by email)"
	}

	in := messageInput{Body: body, Files: files}
	var err error
	if side == "customer" {
		_, err = h.customerReply(ctx, &t, u.ID, in, "email")
	} else {
		_, err = h.supportReply(ctx, &t, u.ID, in, "email")
	}
	if err != nil {
		return "error: " + err.Error(), true // not recorded, so the next poll retries
	}
	return record("added"), true
}

// ─── IMAP poller ──────────────────────────────────────────────────────────────

type imapSettings struct {
	addr, user, pass string
	every            time.Duration
}

func imapConfig() (imapSettings, bool) {
	if strings.EqualFold(os.Getenv("TICKET_MAIL_INBOUND"), "off") {
		return imapSettings{}, false
	}
	host := os.Getenv("IMAP_SERVER")
	if host == "" {
		// Hostinger, Zoho, Gmail and most hosts name them smtp.x / imap.x.
		host = strings.Replace(os.Getenv("SMTP_SERVER"), "smtp.", "imap.", 1)
	}
	port := os.Getenv("IMAP_PORT")
	if port == "" {
		port = "993"
	}
	user := os.Getenv("IMAP_USERNAME")
	if user == "" {
		user = os.Getenv("SMTP_EMAIL")
	}
	pass := os.Getenv("IMAP_PASSWORD")
	if pass == "" {
		pass = os.Getenv("SMTP_PASSWORD")
	}
	secs, _ := strconv.Atoi(os.Getenv("TICKET_MAIL_POLL_SECONDS"))
	if secs < 15 {
		secs = 60
	}
	if host == "" || user == "" || pass == "" {
		return imapSettings{}, false
	}
	return imapSettings{addr: net.JoinHostPort(host, port), user: user, pass: pass, every: time.Duration(secs) * time.Second}, true
}

// StartTicketMailPoller runs for the life of the process. Safe with several
// API replicas: a Postgres advisory lock lets one poll at a time.
func StartTicketMailPoller(db *gorm.DB) {
	cfg, ok := imapConfig()
	if !ok {
		log.Println("✉️  Ticket replies by email disabled (no IMAP settings)")
		return
	}
	h := NewTicketHandler(db)
	log.Printf("✉️  Reading ticket replies from %s every %s", cfg.addr, cfg.every)
	go func() {
		time.Sleep(10 * time.Second)
		for {
			pollTicketMail(db, h, cfg)
			time.Sleep(cfg.every)
		}
	}()
}

const ticketMailLock = 7_311_402

func pollTicketMail(db *gorm.DB, h *TicketHandler, cfg imapSettings) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("✉️  ticket mail poll panicked: %v", r)
		}
	}()
	_ = db.Transaction(func(tx *gorm.DB) error {
		var got bool
		if tx.Raw("SELECT pg_try_advisory_xact_lock(?)", ticketMailLock).Scan(&got); !got {
			return nil
		}
		added, err := readMailbox(h, cfg)
		if err != nil {
			log.Printf("✉️  ticket mail poll: %v", err)
		} else if added > 0 {
			log.Printf("✉️  added %d emailed repl%s to tickets", added, map[bool]string{true: "y", false: "ies"}[added == 1])
		}
		return nil
	})
}

func readMailbox(h *TicketHandler, cfg imapSettings) (int, error) {
	c, err := imapclient.DialWithDialerTLS(&net.Dialer{Timeout: 20 * time.Second}, cfg.addr, nil)
	if err != nil {
		return 0, fmt.Errorf("connect: %w", err)
	}
	c.Timeout = 60 * time.Second
	defer c.Logout()
	if err := c.Login(cfg.user, cfg.pass); err != nil {
		return 0, fmt.Errorf("login: %w", err)
	}

	folders := []string{"INBOX"}
	boxes := make(chan *imap.MailboxInfo, 20)
	done := make(chan error, 1)
	go func() { done <- c.List("", "*", boxes) }()
	for b := range boxes {
		for _, a := range b.Attributes {
			if a == imap.JunkAttr { // replies sometimes land in spam
				folders = append(folders, b.Name)
			}
		}
	}
	<-done

	added := 0
	for _, f := range folders {
		n, err := readFolder(c, h, f)
		if err != nil {
			return added, fmt.Errorf("%s: %w", f, err)
		}
		added += n
	}
	return added, nil
}

// readFolder looks at the last two days of mail in one folder: headers first,
// then the full message only for ticket replies not seen before.
func readFolder(c *imapclient.Client, h *TicketHandler, folder string) (int, error) {
	if _, err := c.Select(folder, true); err != nil { // EXAMINE: read-only
		return 0, err
	}
	crit := imap.NewSearchCriteria()
	crit.Since = time.Now().Add(-48 * time.Hour)
	uids, err := c.UidSearch(crit)
	if err != nil || len(uids) == 0 {
		return 0, err
	}

	headSection := &imap.BodySectionName{
		BodyPartName: imap.BodyPartName{Specifier: imap.HeaderSpecifier, Fields: []string{"MESSAGE-ID", "IN-REPLY-TO", "REFERENCES"}},
		Peek:         true,
	}
	all := new(imap.SeqSet)
	all.AddNum(uids...)
	msgs := make(chan *imap.Message, 50)
	done := make(chan error, 1)
	go func() { done <- c.UidFetch(all, []imap.FetchItem{imap.FetchUid, headSection.FetchItem()}, msgs) }()
	want := new(imap.SeqSet)
	for m := range msgs {
		r := m.GetBody(headSection)
		if r == nil {
			continue
		}
		hdr, err := mail.ReadMessage(io.MultiReader(r, strings.NewReader("\r\n")))
		if err != nil {
			continue
		}
		if _, _, ok := mailer.ParseThreadID(hdr.Header.Get("In-Reply-To"), hdr.Header.Get("References")); !ok {
			continue
		}
		var seen int64
		if id := strings.TrimSpace(hdr.Header.Get("Message-Id")); id != "" {
			h.db.Model(&models.InboundEmail{}).Where("message_id = ?", id).Count(&seen)
		}
		if seen == 0 {
			want.AddNum(m.Uid)
		}
	}
	if err := <-done; err != nil {
		return 0, err
	}
	if want.Empty() {
		return 0, nil
	}

	full := &imap.BodySectionName{Peek: true}
	msgs = make(chan *imap.Message, 10)
	go func() { done <- c.UidFetch(want, []imap.FetchItem{full.FetchItem()}, msgs) }()
	added := 0
	for m := range msgs {
		r := m.GetBody(full)
		if r == nil {
			continue
		}
		raw, _ := io.ReadAll(io.LimitReader(r, 60<<20))
		parsed, err := parseMail(raw)
		if err != nil {
			continue
		}
		res, _ := h.ingestEmail(context.Background(), parsed)
		if res == "added" {
			added++
		} else if res != "already processed" {
			log.Printf("✉️  ticket mail from %s: %s", parsed.From, res)
		}
	}
	return added, <-done
}
