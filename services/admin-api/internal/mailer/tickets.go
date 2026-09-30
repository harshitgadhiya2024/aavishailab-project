package mailer

import (
	"fmt"
	"html"
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

var nonAlnum = regexp.MustCompile(`[^a-zA-Z0-9-]`)

func (t TicketMail) threadHeaders(side string, first bool) map[string]string {
	root := fmt.Sprintf("<ticket-%s-%s@delsecure>", nonAlnum.ReplaceAllString(t.TicketID, ""), side)
	if first {
		return map[string]string{"Message-ID": root}
	}
	return map[string]string{"In-Reply-To": root, "References": root}
}

func (t TicketMail) subject() string { return fmt.Sprintf("[%s] %s", t.Ref, t.Subject) }

// quote renders a message body as an email-safe block, keeping line breaks.
func quote(body string) string {
	return `<div style="margin:12px 0 0 0;padding:14px 16px;background:#f9fafb;border-left:3px solid #FF7000;border-radius:6px;
		font-size:14px;line-height:22px;color:#111827;white-space:pre-wrap;">` + html.EscapeString(body) + `</div>`
}

func attachmentLine(n int) string {
	if n == 0 {
		return ""
	}
	s := "s"
	if n == 1 {
		s = ""
	}
	return fmt.Sprintf(`<p style="margin:10px 0 0 0;font-size:12px;color:#6b7280;">%d attachment%s, open the request to view.</p>`, n, s)
}

// TicketOpenedTeam tells the support team a company raised a request.
func TicketOpenedTeam(to []string, t TicketMail, author, body string, attachments int) {
	info := statTable(
		statRow("Company", t.OrgName, ""),
		statRow("From", author, ""),
		statRow("Topic", t.Category, ""),
		statRow("Priority", t.Priority, ""),
	)
	Send(Message{
		To:      to,
		Subject: t.subject(),
		Headers: t.threadHeaders("team", true),
		HTML: layout("New support request "+t.Ref, html.EscapeString(t.OrgName)+" needs help: <b>"+html.EscapeString(t.Subject)+"</b>",
			info+quote(body)+attachmentLine(attachments), "Open in superadmin", t.Link,
			"Sent to the Delsecure support team for every new request."),
	})
}

// TicketOpenedCustomer confirms the request to the person who raised it.
func TicketOpenedCustomer(to []string, t TicketMail, name, body string) {
	Send(Message{
		To:      to,
		Subject: t.subject(),
		Headers: t.threadHeaders("customer", true),
		HTML: layout("We've got your request", "Hi "+html.EscapeString(name)+", thanks for reaching out. Your reference is <b>"+t.Ref+"</b>.",
			`<p style="margin:0;">Our team usually replies within one business day. We'll email you here as soon as someone answers, and you can follow the conversation anytime in your dashboard.</p>`+quote(body),
			"View your request", t.Link, "You're receiving this because you contacted Delsecure support."),
	})
}

// TicketReplyToCustomer delivers a support reply.
func TicketReplyToCustomer(to []string, t TicketMail, agent, body string, attachments int) {
	Send(Message{
		To:      to,
		Subject: "Re: " + t.subject(),
		Headers: t.threadHeaders("customer", false),
		HTML: layout(agent+" replied", "New reply on your request <b>"+t.Ref+"</b>: "+html.EscapeString(t.Subject),
			quote(body)+attachmentLine(attachments)+`<p style="margin:16px 0 0 0;">Reply from your dashboard to continue the conversation.</p>`,
			"Reply", t.Link, "You're receiving this because you contacted Delsecure support."),
	})
}

// TicketReplyToTeam tells support the company answered.
func TicketReplyToTeam(to []string, t TicketMail, author, body string, attachments int) {
	Send(Message{
		To:      to,
		Subject: "Re: " + t.subject(),
		Headers: t.threadHeaders("team", false),
		HTML: layout(author+" replied", html.EscapeString(t.OrgName)+" replied on <b>"+t.Ref+"</b>.",
			quote(body)+attachmentLine(attachments), "Open in superadmin", t.Link,
			"Sent to the Delsecure support team for every customer reply."),
	})
}

// TicketResolvedCustomer tells the customer the request was resolved and
// that replying reopens it.
func TicketResolvedCustomer(to []string, t TicketMail, name string) {
	Send(Message{
		To:      to,
		Subject: "Resolved: " + t.subject(),
		Headers: t.threadHeaders("customer", false),
		HTML: layout("Your request was resolved", "Hi "+html.EscapeString(name)+", we've marked <b>"+t.Ref+"</b> as resolved.",
			`<p style="margin:0;">If it isn't fixed for you, just reply from your dashboard and the request reopens. We'd also love to know whether this solved it.</p>`,
			"Tell us how we did", t.Link, "You're receiving this because you contacted Delsecure support."),
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
