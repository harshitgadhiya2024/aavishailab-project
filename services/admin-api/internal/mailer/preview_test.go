package mailer

import (
	"encoding/base64"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// TestTemplatePreviews renders every email with sample data and checks the
// branded shell is intact. Set MAIL_PREVIEW_DIR to also write each one as an
// .html file, plus all-emails.html showing every one on a single page:
//
//	MAIL_PREVIEW_DIR=./mail-previews go test ./internal/mailer -run TestTemplatePreviews
func TestTemplatePreviews(t *testing.T) {
	cfg = Config{
		FromEmail: "security@aavishield.com", AppURL: "https://app.aavishield.com",
		PortalURL: "https://portal.aavishield.com", SuperadminURL: "https://admin.aavishield.com",
	}
	// Capture instead of delivering: Send only queues, and no worker runs.
	enabled, queue = true, make(chan Message, 128)
	defer func() { enabled, queue = false, nil }()

	invite := DemoInvite{UID: "demo-1", Start: time.Date(2026, 11, 20, 10, 30, 0, 0, time.UTC), Minutes: 30, Attendee: "ayumi@corvane.io"}
	ticket := TicketMail{TicketID: "6f1c", Ref: "DS-1042", Subject: "Agent won't start after update", OrgName: "Corvane Logistics", Category: "Agent & devices", Priority: "High", Link: "https://app.aavishield.com/dashboard/support/6f1c"}
	a, one := []string{"admin@corvane.io"}, "ayumi@corvane.io"
	domains := []string{"wetransfer.com", "drive.google.com", "pastebin.com"}

	samples := []struct {
		name string
		send func()
	}{
		{"welcome-org", func() { WelcomeOrg(one, "Ayumi", "Corvane Logistics") }},
		{"invite-user", func() {
			InviteUser(one, "Ayumi", "Corvane Logistics", "Security analyst", "Tq7-mR2x-9Lp", "Matteo Fiorentino")
		}},
		{"password-reset", func() { PasswordReset(one, "Ayumi", "tok_abc123", false) }},
		{"password-changed", func() { PasswordChanged(one, "Ayumi", false) }},
		{"portal-access-ready", func() { PortalAccessReady(one, "Ayumi", "Corvane Logistics", "Tq7-mR2x-9Lp") }},
		{"access-request-submitted", func() {
			AccessRequestSubmitted(a, "Ayumi Tanabe", one, "Website", "wetransfer.com", "Need to send files to a client", "File sharing policy")
		}},
		{"access-request-approved", func() {
			AccessRequestResolved(one, "Ayumi", "Website", "wetransfer.com", "approved", "Approved for the Q4 audit only")
		}},
		{"access-request-denied", func() { AccessRequestResolved(one, "Ayumi", "Website", "wetransfer.com", "denied", "") }},
		{"security-alert", func() {
			SecurityAlert(a, "Corvane Logistics", "Malware blocked", "Ayumi Tanabe", "invoice_2026.exe", "Trojan.GenericKD detected on download", 92)
		}},
		{"activity-digest", func() { ActivityDigest(a, "Corvane Logistics", 24, 14, 6, 3, 1, 2, domains) }},
		{"no-activity", func() { NoActivityNotice(a, "Corvane Logistics", 5, 12, 0) }},
		{"employee-inactivity", func() { EmployeeInactivityNotice(one, "Ayumi", "Corvane Logistics", 7) }},
		{"device-enrolled", func() { DeviceEnrolled(a, "Corvane Logistics", "AYUMI-LAPTOP", "Ayumi Tanabe", "Windows 11") }},
		{"weekly-summary", func() { WeeklySummary(a, "Corvane Logistics", 42, 17, 4, 38, 41, domains) }},
		{"mfa-enabled", func() { MFAEnabled(one, "Ayumi") }},
		{"mfa-disabled", func() { MFADisabled(one, "Ayumi") }},
		{"mfa-recovery-used", func() { MFARecoveryCodeUsed(one, "Ayumi", 2, "103.21.58.4") }},
		{"mfa-required", func() { MFARequired(one, "Ayumi", "Corvane Logistics") }},
		{"login-code", func() { LoginCode(one, "Ayumi", "482913", 10) }},
		{"registration-code", func() { RegistrationCode(one, "Ayumi", "731064", 15) }},
		{"device-disconnected", func() {
			DeviceDisconnected(a, "Corvane Logistics", "Ayumi Tanabe", "AYUMI-LAPTOP", "17 Nov 2026, 14:05 IST")
		}},
		{"device-uninstalled", func() {
			DeviceUninstalled(a, "Corvane Logistics", "Ayumi Tanabe", "AYUMI-LAPTOP", "Matteo Fiorentino", "17 Nov 2026, 14:05 IST")
		}},
		{"device-connected", func() {
			DeviceConnected(a, "Corvane Logistics", "Ayumi Tanabe", "AYUMI-LAPTOP", "17 Nov 2026, 15:20 IST")
		}},
		{"device-reconnect", func() { DeviceReconnect(one, "Ayumi", "Corvane Logistics", "AYUMI-LAPTOP") }},
		{"demo-request-received", func() {
			DemoRequestReceived(a, "Ayumi Tanabe", one, "Corvane Logistics", "50", "DLP for laptops and USB control", "/pricing")
		}},
		{"demo-request-confirmation", func() { DemoRequestConfirmation(one, "Ayumi") }},
		{"demo-booked", func() { DemoBookedConfirmation(one, "Ayumi", "Fri 20 Nov, 4:00 PM IST", invite) }},
		{"demo-cancelled-team", func() { DemoBookingCancelled(a, "Ayumi Tanabe", one, "Corvane Logistics", "Fri 20 Nov, 4:00 PM IST") }},
		{"demo-cancelled", func() { DemoCancelledConfirmation(one, "Ayumi", "Fri 20 Nov, 4:00 PM IST", invite) }},
		{"demo-meeting-link", func() {
			DemoMeetingLink(one, "Ayumi", "Fri 20 Nov, 4:00 PM IST", "https://meet.google.com/abc-defg-hij", invite)
		}},
		{"demo-reminder", func() {
			DemoReminder(one, "Ayumi", "tomorrow at 4:00 PM IST", "tomorrow", "https://meet.google.com/abc-defg-hij")
		}},
		{"waitlist-joined", func() {
			WaitlistJoined(a, "Ayumi Tanabe", one, "Corvane Logistics", "11–50", "IT manager", "/waitlist")
		}},
		{"waitlist-confirmation", func() { WaitlistConfirmation(one, "Ayumi") }},
		{"waitlist-invite", func() { WaitlistInvite(one, "Ayumi") }},
		{"datastore-unreachable", func() {
			DataStoreUnreachable(a, "Corvane Logistics", "database", "dial tcp 10.0.4.12:5432: i/o timeout")
		}},
		{"datastore-recovered", func() { DataStoreRecovered(a, "Corvane Logistics", "database") }},
		{"trial-ending", func() { TrialEndingSoon(a, "Corvane Logistics", 3, "20 Nov 2026") }},
		{"trial-ended", func() { TrialEnded(a, "Corvane Logistics", false) }},
		{"invoice-raised", func() {
			InvoiceRaised(a, "Corvane Logistics", "Business", 40, "yearly", "₹1,91,520", "https://rzp.io/i/abc123", false)
		}},
		{"plan-activated", func() { PlanActivated(a, "Corvane Logistics", "Business", 40, "20 Nov 2027") }},
		{"checkout-awaiting-invoice", func() { CheckoutAwaitingInvoice(a, "Corvane Logistics", "Business", 40, "yearly", "₹1,91,520") }},
		{"payment-received-team", func() { PaymentReceivedTeam(a, "Corvane Logistics", "Business", 40, "₹1,91,520") }},
		{"ticket-opened-team", func() {
			TicketOpenedTeam(a, ticket, "Ayumi Tanabe", "After yesterday's update the agent shows 'Disconnected'.\nRestarting didn't help.", 1)
		}},
		{"ticket-opened-customer", func() {
			TicketOpenedCustomer(a, ticket, "Ayumi", "After yesterday's update the agent shows 'Disconnected'.")
		}},
		{"ticket-reply-customer", func() {
			TicketReplyToCustomer(a, ticket, "Thandiwe from Aavishield", "Thanks Ayumi — please try version 2.4.1, it fixes this.", 0)
		}},
		{"ticket-reply-team", func() { TicketReplyToTeam(a, ticket, "Ayumi Tanabe", "That worked, thank you!", 0) }},
		{"ticket-resolved", func() { TicketResolvedCustomer(a, ticket, "Ayumi") }},
	}

	dir := os.Getenv("MAIL_PREVIEW_DIR")
	// Previews inline the email images from the repo as data URIs, so new
	// artwork can be reviewed before the dashboard that hosts it is deployed,
	// and each preview file opens on its own.
	brandDir := filepath.Join("..", "..", "..", "..", "frontend", "company-dashboard", "public", "brand")
	inlineAssets := func(page string) string { return page }
	if dir != "" && os.Getenv("MAIL_ASSET_URL") == "" {
		const placeholder = "preview-asset:"
		t.Setenv("MAIL_ASSET_URL", placeholder)
		inlineAssets = func(page string) string {
			return regexp.MustCompile(placeholder+`/([\w.-]+\.png)`).ReplaceAllStringFunc(page, func(m string) string {
				b, err := os.ReadFile(filepath.Join(brandDir, strings.TrimPrefix(m, placeholder+"/")))
				if err != nil {
					t.Errorf("preview asset %s: %v", m, err)
					return m
				}
				return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b)
			})
		}
	}
	if dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	var index strings.Builder
	n := 0
	cssLeak := regexp.MustCompile(`[{}]|@media|font-family`)
	badVerb := regexp.MustCompile(`%![a-zA-Z]?\(`) // fmt's %!s(MISSING), %!(EXTRA …)

	for _, s := range samples {
		s.send()
		var msg Message
		select {
		case msg = <-queue:
		default:
			t.Errorf("%s: nothing was sent", s.name)
			continue
		}
		for _, want := range []string{"Secure today. Enable tomorrow.", "<!--preheader-->", logoURL()} {
			if !strings.Contains(msg.HTML, want) {
				t.Errorf("%s: HTML is missing %q", s.name, want)
			}
		}
		if badVerb.MatchString(msg.HTML) {
			t.Errorf("%s: fmt verb mismatch in HTML", s.name)
		}
		text := stripHTML(msg.HTML)
		if cssLeak.MatchString(text) {
			t.Errorf("%s: CSS leaked into the plain-text part:\n%s", s.name, text)
		}
		if dir != "" {
			if err := os.WriteFile(filepath.Join(dir, s.name+".html"), []byte(inlineAssets(msg.HTML)), 0o644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, s.name+".txt"), []byte(text), 0o644); err != nil {
				t.Fatal(err)
			}
			// Each email is embedded whole (srcdoc), so the gallery is one
			// self-contained file that opens anywhere.
			n++
			fmt.Fprintf(&index, `<section><header><span class="n">%02d</span><b>%s</b><small>%s</small></header>
<iframe loading="lazy" title="%s" srcdoc="%s"></iframe></section>`,
				n, html.EscapeString(s.name), html.EscapeString(msg.Subject), html.EscapeString(s.name),
				html.EscapeString(inlineAssets(msg.HTML)))
		}
	}

	if dir != "" {
		page := fmt.Sprintf(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aavishield emails</title>
<style>
body{margin:0;background:#f1f1f2;font:14px/1.4 Inter,system-ui,sans-serif;color:#0b0b0d}
h1{font-weight:400;font-size:32px;letter-spacing:-1px;margin:32px 16px 4px}
p.sub{margin:0 16px 24px;color:#5d5d66}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(640px,1fr));gap:24px;padding:0 16px 48px}
section{background:#fff;border:1px solid #e7e7ea;border-radius:10px;overflow:hidden}
header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid #e7e7ea}
.n{font:12px 'DM Mono',ui-monospace,monospace;color:#c2410c}small{color:#5d5d66;flex-basis:100%%}
iframe{display:block;width:100%%;height:1400px;border:0;background:#fafafa}
@media (max-width:700px){main{grid-template-columns:1fr}}
</style>
<h1>Aavishield emails</h1><p class="sub">All %d transactional emails with sample data. Each frame is the exact HTML the mailer sends.</p>
<main>%s</main>
<script>
for (const f of document.querySelectorAll('iframe')) {
  f.addEventListener('load', () => { try { f.style.height = f.contentDocument.documentElement.scrollHeight + 'px'; } catch (e) {} });
}
</script></html>`, n, index.String())
		if err := os.WriteFile(filepath.Join(dir, "all-emails.html"), []byte(page), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
