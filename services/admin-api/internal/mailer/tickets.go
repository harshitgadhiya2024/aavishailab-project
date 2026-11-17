package mailer

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"os"
	"regexp"
	"strings"
)

// Support ticket email. Every message about one ticket carries the same
// "[DS-1042]" subject and threading headers, so each side sees the whole
// conversation as one email thread.

type TicketMail struct {
	TicketID string
	Ref      string // "DS-1042"
	Subject  string
	OrgName  string
	Category string
	Priority string
	// Link is the ticket page in the recipient's own app.
	Link string
}

// ─── Threading and reply routing ─────────────────────────────────────────────
//
// The first email to each side of a ticket carries a Message-ID that encodes
// the ticket, the side (customer or team) and an HMAC over both. Mail clients
// quote that ID back in In-Reply-To / References when someone hits Reply, which
// is how an inbound reply is routed to its ticket. The signature is what makes
// that safe: without the server secret nobody can forge an ID that routes
// mail into a ticket, however much they know about it.

func threadSecret() []byte {
	for _, k := range []string{"TICKET_MAIL_SECRET", "INTERNAL_API_SECRET", "MEDIA_SIGNING_SECRET"} {
		if v := os.Getenv(k); v != "" {
			return []byte(v)
		}
	}
	return []byte("aavishield-dev-ticket-mail")
}

func threadSig(ticketID, side string) string {
	m := hmac.New(sha256.New, threadSecret())
	m.Write([]byte("ticket-mail:" + ticketID + ":" + side))
	return hex.EncodeToString(m.Sum(nil))[:24]
}

func mailDomain() string {
	if i := strings.LastIndexByte(cfg.FromEmail, '@'); i >= 0 {
		return cfg.FromEmail[i+1:]
	}
	return "aavishield.local"
}

// ThreadMessageID is the root Message-ID for one side of a ticket's thread.
func ThreadMessageID(ticketID, side string) string {
	return fmt.Sprintf("<t.%s.%s.%s@%s>", ticketID, side, threadSig(ticketID, side), mailDomain())
}

var threadIDRe = regexp.MustCompile(`<t\.([0-9a-fA-F-]{36})\.(customer|team)\.([0-9a-f]{24})@[^>]+>`)

// ParseThreadID finds a valid, correctly signed ticket thread ID in header
// text (In-Reply-To, References). It returns the ticket ID and the side the
// original email was sent to.
func ParseThreadID(headers ...string) (ticketID, side string, ok bool) {
	for _, h := range headers {
		for _, m := range threadIDRe.FindAllStringSubmatch(h, -1) {
			if hmac.Equal([]byte(m[3]), []byte(threadSig(strings.ToLower(m[1]), m[2]))) {
				return strings.ToLower(m[1]), m[2], true
			}
		}
	}
	return "", "", false
}

// ReplyMarker is written at the top of every ticket email; inbound replies
// are cut at it so the quoted email below never lands in the ticket.
const ReplyMarker = "##- Reply above this line -##"

func (t TicketMail) threadHeaders(side string, first bool) map[string]string {
	root := ThreadMessageID(t.TicketID, side)
	if first {
		return map[string]string{"Message-ID": root, "Reply-To": cfg.FromEmail}
	}
	return map[string]string{"In-Reply-To": root, "References": root, "Reply-To": cfg.FromEmail}
}

// withMarker puts the reply marker above the email card.
func withMarker(page, ref string) string {
	row := `<tr><td align="center" style="font-family:` + fontSans + `;font-size:12px;color:#a1a1aa;padding:0 0 16px 0;">` + ReplyMarker +
		` <span style="color:#c4c4cc;">Reply to this email to add to ` + ref + `</span></td></tr>`
	return strings.Replace(page, `<!--marker-->`, row, 1)
}

func (t TicketMail) subject() string { return fmt.Sprintf("[%s] %s", t.Ref, t.Subject) }

const teamHint = `<p style="margin:16px 0 0 0;">Reply to this email to answer the customer; it's added to the request and emailed to them. Use the console for internal notes.</p>`

// TicketOpenedTeam tells the support team a company raised a request.
func TicketOpenedTeam(to []string, t TicketMail, author, body string, attachments int) {
	rows := []string{statRow("Company", t.OrgName, ""), statRow("From", author, "")}
	if t.Category != "" {
		rows = append(rows, statRow("Topic", t.Category, ""))
	}
	if t.Priority != "" {
		rows = append(rows, statRow("Priority", t.Priority, ""))
	}
	info := statTable(rows...)
	Send(Message{
		To:      to,
		Subject: t.subject(),
		Headers: t.threadHeaders("team", true),
		HTML: withMarker(layout(kSupport, "New support request ^"+t.Ref, html.EscapeString(t.OrgName)+" needs help: <b>"+html.EscapeString(t.Subject)+"</b>",
			info+messageCard(message{author: author, role: "Customer · " + t.OrgName, ref: t.Ref, body: body, attachments: attachments})+teamHint, "Open in superadmin", t.Link,
			"Sent to the Aavishield support team for every new request."), t.Ref),
	})
}

// TicketOpenedCustomer confirms the request to the person who raised it.
func TicketOpenedCustomer(to []string, t TicketMail, name, body string) {
	Send(Message{
		To:      to,
		Subject: t.subject(),
		Headers: t.threadHeaders("customer", true),
		HTML: withMarker(layout(kSupport, "We've got ^your request", "Hi "+html.EscapeString(name)+", thanks for reaching out. Your reference is <b>"+t.Ref+"</b>.",
			`<p style="margin:0;">Our team usually replies within one business day. We'll email you as soon as someone answers. To add anything, just reply to this email or use your dashboard.</p>`+messageCard(message{author: name, role: "Your message", ref: t.Ref, body: body}),
			"View your request", t.Link, "You're receiving this because you contacted Aavishield support."), t.Ref),
	})
}

// TicketReplyToCustomer delivers a support reply.
func TicketReplyToCustomer(to []string, t TicketMail, agent, body string, attachments int) {
	Send(Message{
		To:      to,
		Subject: "Re: " + t.subject(),
		Headers: t.threadHeaders("customer", false),
		HTML: withMarker(layout(kSupport, agent+" ^replied", "New reply on your request <b>"+t.Ref+"</b>: "+html.EscapeString(t.Subject),
			messageCard(message{author: agent, role: "Aavishield support", team: true, ref: t.Ref, body: body, attachments: attachments})+`<p style="margin:16px 0 0 0;">Just reply to this email to answer, or continue in your dashboard.</p>`,
			"Reply", t.Link, "You're receiving this because you contacted Aavishield support."), t.Ref),
	})
}

// TicketReplyToTeam tells support the company answered.
func TicketReplyToTeam(to []string, t TicketMail, author, body string, attachments int) {
	Send(Message{
		To:      to,
		Subject: "Re: " + t.subject(),
		Headers: t.threadHeaders("team", false),
		HTML: withMarker(layout(kSupport, author+" ^replied", html.EscapeString(t.OrgName)+" replied on <b>"+t.Ref+"</b>.",
			messageCard(message{author: author, role: "Customer · " + t.OrgName, ref: t.Ref, body: body, attachments: attachments})+teamHint, "Open in superadmin", t.Link,
			"Sent to the Aavishield support team for every customer reply."), t.Ref),
	})
}

// TicketResolvedCustomer tells the customer the request was resolved and
// that replying reopens it.
func TicketResolvedCustomer(to []string, t TicketMail, name string) {
	Send(Message{
		To:      to,
		Subject: "Resolved: " + t.subject(),
		Headers: t.threadHeaders("customer", false),
		HTML: withMarker(layout(kSupportDone, "Your request was ^resolved", "Hi "+html.EscapeString(name)+", we've marked <b>"+t.Ref+"</b> as resolved.",
			`<p style="margin:0;">If it isn't fixed for you, just reply to this email and the request reopens. We'd also love to know whether this solved it.</p>`,
			"Tell us how we did", t.Link, "You're receiving this because you contacted Aavishield support."), t.Ref),
	})
}

// TicketRef formats a ticket number the way customers see it.
func TicketRef(n int64) string { return fmt.Sprintf("DS-%d", n) }

// Titleish turns "data_protection" into "Data protection".
func Titleish(s string) string {
	s = strings.ReplaceAll(s, "_", " ")
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
