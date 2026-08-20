// Package mailer sends the product's transactional and alert email.
//
// Delivery is asynchronous by design: an HTTP handler queues a message and
// returns immediately. A password reset must not fail because an SMTP server
// was slow, and a security alert must not add a second of latency to the
// request that triggered it.
package mailer

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Message struct {
	To      []string
	Subject string
	HTML    string
	Text    string
}

type Config struct {
	Host      string
	Port      int
	Username  string
	Password  string
	FromName  string
	FromEmail string
	// SuperadminEmail receives platform-level notices (delivery failures worth
	// a human's attention, org signups).
	SuperadminEmail string
	AppURL          string
	PortalURL       string
}

var (
	cfg     Config
	queue   chan Message
	once    sync.Once
	enabled bool
)

// Init reads configuration and starts the sender. Safe to call once at boot;
// when SMTP isn't configured the package degrades to logging what it would
// have sent, so development doesn't need a mail server.
func Init() {
	once.Do(func() {
		port, _ := strconv.Atoi(os.Getenv("SMTP_PORT"))
		if port == 0 {
			port = 587
		}
		cfg = Config{
			Host:            os.Getenv("SMTP_SERVER"),
			Port:            port,
			Username:        os.Getenv("SMTP_EMAIL"),
			Password:        os.Getenv("SMTP_PASSWORD"),
			FromName:        envOr("SMTP_FROM_NAME", "Delsecure Security"),
			FromEmail:       envOr("SMTP_FROM_EMAIL", os.Getenv("SMTP_EMAIL")),
			SuperadminEmail: os.Getenv("SUPERADMIN_MAIL"),
			AppURL:          envOr("COMPANY_APP_URL", envOr("NEXTAUTH_URL_COMPANY", "http://localhost:5002")),
			PortalURL:       envOr("EMPLOYEE_PORTAL_URL", envOr("NEXTAUTH_URL_EMPLOYEE", "http://localhost:5003")),
		}

		enabled = cfg.Host != "" && cfg.Username != "" && cfg.Password != ""
		if !enabled {
			log.Println("✉️  Mailer disabled — SMTP_SERVER / SMTP_EMAIL / SMTP_PASSWORD not set")
			return
		}

		queue = make(chan Message, 512)
		go worker()
		log.Printf("✉️  Mailer ready (%s:%d as %s)", cfg.Host, cfg.Port, cfg.FromEmail)
	})
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func Enabled() bool { return enabled }

// Settings exposes the URLs templates need for links.
func Settings() Config { return cfg }

// Send queues a message. It never blocks: if the queue is full the message is
// dropped with a log line rather than stalling the request that produced it.
func Send(msg Message) {
	if !enabled {
		log.Printf("✉️  [mail disabled] would send %q to %v", msg.Subject, msg.To)
		return
	}
	msg.To = validRecipients(msg.To)
	if len(msg.To) == 0 {
		return
	}
	select {
	case queue <- msg:
	default:
		log.Printf("✉️  mail queue full — dropped %q to %v", msg.Subject, msg.To)
	}
}

func validRecipients(list []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(list))
	for _, addr := range list {
		a := strings.TrimSpace(strings.ToLower(addr))
		if a == "" || !strings.Contains(a, "@") || seen[a] {
			continue
		}
		seen[a] = true
		out = append(out, a)
	}
	return out
}

// deliveryAttempts is how many times a message is tried before it is dropped.
// SMTP failures are often transient (a rate limit, a dropped connection), and a
// password-reset email that vanishes on the first hiccup is worse than one that
// arrives a few seconds late.
const deliveryAttempts = 3

func worker() {
	for msg := range queue {
		var lastErr error
		for attempt := 1; attempt <= deliveryAttempts; attempt++ {
			if lastErr = deliver(msg); lastErr == nil {
				break
			}
			// An authentication failure will not fix itself on a retry.
			if strings.Contains(lastErr.Error(), "535") || strings.Contains(lastErr.Error(), "auth:") {
				break
			}
			if attempt < deliveryAttempts {
				time.Sleep(time.Duration(attempt*attempt) * 2 * time.Second)
			}
		}
		if lastErr != nil {
			log.Printf("✉️  failed to send %q to %v after retries: %v", msg.Subject, msg.To, lastErr)
		}
	}
}

// deliver speaks SMTP. Port 465 is implicit TLS (the connection is encrypted
// before any SMTP command); everything else negotiates STARTTLS. Getting this
// wrong is the classic cause of a silent hang on 465.
func deliver(msg Message) error {
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	body := buildMIME(msg)

	if cfg.Port == 465 {
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: cfg.Host})
		if err != nil {
			return fmt.Errorf("tls dial: %w", err)
		}
		client, err := smtp.NewClient(conn, cfg.Host)
		if err != nil {
			conn.Close()
			return fmt.Errorf("smtp client: %w", err)
		}
		defer client.Quit()
		return sendWithClient(client, auth, msg, body)
	}

	client, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer client.Quit()

	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
	}
	return sendWithClient(client, auth, msg, body)
}

func sendWithClient(client *smtp.Client, auth smtp.Auth, msg Message, body []byte) error {
	if ok, _ := client.Extension("AUTH"); ok {
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("auth: %w", err)
		}
	}
	if err := client.Mail(cfg.FromEmail); err != nil {
		return fmt.Errorf("mail from: %w", err)
	}
	for _, to := range msg.To {
		if err := client.Rcpt(to); err != nil {
			return fmt.Errorf("rcpt %s: %w", to, err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("data: %w", err)
	}
	if _, err := w.Write(body); err != nil {
		return fmt.Errorf("write: %w", err)
	}
	return w.Close()
}

// buildMIME assembles a multipart/alternative message so clients that refuse
// HTML still get a readable version.
func buildMIME(msg Message) []byte {
	boundary := fmt.Sprintf("delsecure-%d", time.Now().UnixNano())
	var b strings.Builder

	fmt.Fprintf(&b, "From: %s <%s>\r\n", cfg.FromName, cfg.FromEmail)
	fmt.Fprintf(&b, "To: %s\r\n", strings.Join(msg.To, ", "))
	fmt.Fprintf(&b, "Subject: %s\r\n", msg.Subject)
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	b.WriteString("MIME-Version: 1.0\r\n")
	fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary)

	text := msg.Text
	if text == "" {
		text = stripHTML(msg.HTML)
	}
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n\r\n", boundary, text)
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n\r\n", boundary, msg.HTML)
	fmt.Fprintf(&b, "--%s--\r\n", boundary)

	return []byte(b.String())
}

func stripHTML(html string) string {
	replacer := strings.NewReplacer(
		"<br>", "\n", "<br/>", "\n", "<br />", "\n",
		"</p>", "\n\n", "</div>", "\n", "</tr>", "\n", "</h1>", "\n\n", "</h2>", "\n\n",
	)
	s := replacer.Replace(html)
	var out strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			out.WriteRune(r)
		}
	}
	lines := strings.Split(out.String(), "\n")
	cleaned := make([]string, 0, len(lines))
	for _, l := range lines {
		if t := strings.TrimSpace(l); t != "" {
			cleaned = append(cleaned, t)
		}
	}
	return strings.Join(cleaned, "\n")
}
