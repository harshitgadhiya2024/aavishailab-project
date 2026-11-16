package mailer

import (
	"fmt"
	"html"
)

// Emails for the self-serve funnel after sign-up: demo bookings made from the
// console, trial reminders, and self-serve billing.

const consoleFooter = "You're receiving this because you're an admin of your company's Aavishield console."

func billingURL() string { return cfg.AppURL + "/dashboard/billing" }

// ─── Demo bookings ───────────────────────────────────────────────────────────

// DemoBookingCancelled tells the team a company cancelled its booked demo.
func DemoBookingCancelled(to []string, name, email, company, when string) {
	body := statTable(
		statRow("Company", company, ""),
		statRow("Booked by", name+" <"+email+">", ""),
		statRow("Was booked for", when, ""),
	)
	Send(Message{
		To:      to,
		Subject: "Demo cancelled: " + company,
		HTML: layout("Demo cancelled",
			html.EscapeString(company)+" cancelled their demo from the console. The slot is free again.",
			body, "Open in superadmin", cfg.SuperadminURL+"/dashboard/demo-requests",
			"Sent to the Aavishield team when a console booking changes."),
	})
}

// DemoCancelledConfirmation confirms the cancellation to the customer and
// removes the event from their calendar.
func DemoCancelledConfirmation(to, name, when string, invite DemoInvite) {
	invite.Cancel = true
	body := fmt.Sprintf(`<p style="margin:0;">Your demo on <strong>%s</strong> is cancelled.</p>
	<p style="margin:16px 0 0 0;">You can book another time from your console whenever it suits you.</p>`, html.EscapeString(when))
	Send(Message{
		To:      []string{to},
		Subject: "Your Aavishield demo is cancelled",
		HTML: layout("Demo cancelled", "Hi "+html.EscapeString(name)+", we've cancelled your demo.",
			body, "Open your console", cfg.AppURL+"/dashboard", consoleFooter),
		Calendar: invite.part(),
	})
}

// DemoMeetingLink sends the call link the team added in superadmin, and
// updates the calendar event with it.
func DemoMeetingLink(to, name, when, meetingURL string, invite DemoInvite) {
	invite.MeetingURL = meetingURL
	body := fmt.Sprintf(`<p style="margin:0;">Here's the link for your Aavishield demo on <strong>%s</strong>.</p>
	<p style="margin:16px 0 0 0;word-break:break-all;"><a href="%s" style="color:#FF7000;">%s</a></p>`,
		html.EscapeString(when), html.EscapeString(meetingURL), html.EscapeString(meetingURL))
	Send(Message{
		To:      []string{to},
		Subject: "Meeting link for your Aavishield demo",
		HTML: layout("Your demo link", "Hi "+html.EscapeString(name)+", you're all set.",
			body, "Join the call", meetingURL,
			"You're receiving this because you booked a demo from your Aavishield console."),
		Calendar: invite.part(),
	})
}

// DemoReminder reminds the customer of an upcoming demo. lead is "tomorrow"
// or "in an hour"; meetingURL may be empty.
func DemoReminder(to, name, when, lead, meetingURL string) {
	link := `<p style="margin:16px 0 0 0;">We'll email the meeting link before the call.</p>`
	if meetingURL != "" {
		link = fmt.Sprintf(`<p style="margin:16px 0 0 0;word-break:break-all;">Join here: <a href="%s" style="color:#FF7000;">%s</a></p>`,
			html.EscapeString(meetingURL), html.EscapeString(meetingURL))
	}
	body := fmt.Sprintf(`<p style="margin:0;">Your 30-minute Aavishield demo is <strong>%s</strong>: %s.</p>%s`,
		html.EscapeString(lead), html.EscapeString(when), link)
	Send(Message{
		To:      []string{to},
		Subject: "Reminder: your Aavishield demo is " + lead,
		HTML: layout("See you "+html.EscapeString(lead), "Hi "+html.EscapeString(name)+", a quick reminder.",
			body, "", "",
			"You're receiving this because you booked a demo from your Aavishield console."),
	})
}

// ─── Devices ─────────────────────────────────────────────────────────────────

// DeviceReconnect asks an employee to reconnect a device their administrator
// revoked: the agent on it shows Reconnect, and signing in brings it back.
func DeviceReconnect(to, firstName, orgName, hostname string) {
	body := fmt.Sprintf(`<p style="margin:0;">%s asked you to reconnect <strong>%s</strong> to Aavishield.</p>
	<ol style="margin:16px 0 0 0;padding-left:20px;">
	  <li style="margin-bottom:6px;">On that computer, open the <strong>Aavishield</strong> app (from the menu bar or system tray, or the Start menu).</li>
	  <li style="margin-bottom:6px;">Click <strong>Reconnect</strong>. If the app shows Connect instead, click that.</li>
	  <li>A browser page opens: sign in with your employee portal account. The device reconnects on its own.</li>
	</ol>
	<p style="margin:16px 0 0 0;">If Aavishield isn't installed on it any more, sign in to the portal below and download it again.</p>`,
		html.EscapeString(orgName), html.EscapeString(hostname))
	Send(Message{
		To:      []string{to},
		Subject: "Please reconnect " + hostname + " to Aavishield",
		HTML: layout("Reconnect your device", "Hi "+html.EscapeString(firstName)+", your IT team needs this device back on Aavishield.",
			body, "Open the employee portal", cfg.PortalURL+"/login",
			"You're receiving this because your company uses Aavishield to protect its devices."),
	})
}

// ─── Trial ───────────────────────────────────────────────────────────────────

// TrialEndingSoon warns admins a self-serve trial ends in daysLeft days.
func TrialEndingSoon(to []string, orgName string, daysLeft int, endsOn string) {
	when := fmt.Sprintf("in %d days", daysLeft)
	if daysLeft <= 1 {
		when = "tomorrow"
	}
	body := fmt.Sprintf(`<p style="margin:0;">Your Aavishield free trial for <strong>%s</strong> ends %s (%s).</p>
	<p style="margin:16px 0 0 0;">Choose a plan to keep changing policies and adding devices. If the trial ends first,
	your devices stay protected with the policies you have now, but the console becomes read-only until you pay.</p>`,
		html.EscapeString(orgName), when, html.EscapeString(endsOn))
	Send(Message{
		To:      to,
		Subject: "Your Aavishield trial ends " + when,
		HTML:    layout("Your trial ends "+when, "Keep your team covered without a gap.", body, "Choose a plan", billingURL(), consoleFooter),
	})
}

// TrialEnded tells admins the org is now read-only. lapsed is true when a paid
// period ran out (rather than a trial).
func TrialEnded(to []string, orgName string, lapsed bool) {
	heading, subject := "Your free trial has ended", "Your Aavishield trial has ended"
	if lapsed {
		heading, subject = "Your subscription has lapsed", "Your Aavishield subscription has lapsed"
	}
	body := fmt.Sprintf(`<p style="margin:0;">Devices at <strong>%s</strong> are still protected with your current policies,
	but the console is now read-only and new devices can't be added.</p>
	<p style="margin:16px 0 0 0;">Choose a plan and pay online to unlock everything straight away.</p>`, html.EscapeString(orgName))
	Send(Message{
		To:      to,
		Subject: subject,
		HTML:    layout(heading, "Nothing has been switched off on your devices.", body, "Choose a plan", billingURL(), consoleFooter),
	})
}

// ─── Billing ─────────────────────────────────────────────────────────────────

// InvoiceRaised sends a self-serve invoice with its payment link. renewal is
// true for the automatic renewal a week before the paid period ends.
func InvoiceRaised(to []string, orgName, planName string, seats int, cycle, amount, payURL string, renewal bool) {
	heading, subject := "Complete your Aavishield purchase", "Your Aavishield invoice: "+amount
	if renewal {
		heading, subject = "Time to renew Aavishield", "Renew Aavishield: "+amount
	}
	body := statTable(
		statRow("Company", orgName, ""),
		statRow("Plan", planName, ""),
		statRow("Devices", fmt.Sprint(seats), ""),
		statRow("Billed", cycle, ""),
		statRow("Total (incl. tax)", amount, "#FF7000"),
	)
	ctaLabel, ctaURL := "Pay now", payURL
	if payURL == "" {
		ctaLabel, ctaURL = "Open billing", billingURL()
		body += `<p style="margin:16px 0 0 0;">Our team will send the payment link shortly.</p>`
	}
	Send(Message{
		To:      to,
		Subject: subject,
		HTML:    layout(heading, "Pay securely through Razorpay.", body, ctaLabel, ctaURL, consoleFooter),
	})
}

// PlanActivated confirms a self-serve payment and the paid period.
func PlanActivated(to []string, orgName, planName string, seats int, paidThrough string) {
	body := statTable(
		statRow("Plan", planName, ""),
		statRow("Devices", fmt.Sprint(seats), ""),
		statRow("Paid through", paidThrough, ""),
	) + `<p style="margin:16px 0 0 0;">Everything in your console is unlocked. Thank you for choosing Aavishield.</p>`
	Send(Message{
		To:      to,
		Subject: "Payment received: " + orgName + " is on " + planName,
		HTML:    layout("You're all set", html.EscapeString(orgName)+" is now on "+html.EscapeString(planName)+".", body, "Open your console", cfg.AppURL+"/dashboard", consoleFooter),
	})
}

// CheckoutAwaitingInvoice tells the team a company chose a plan while online
// payment (Razorpay) isn't configured, so someone has to send the link.
func CheckoutAwaitingInvoice(to []string, orgName, planName string, seats int, cycle, amount string) {
	body := statTable(
		statRow("Company", orgName, ""),
		statRow("Plan", planName, ""),
		statRow("Devices", fmt.Sprint(seats), ""),
		statRow("Billed", cycle, ""),
		statRow("Total (incl. tax)", amount, ""),
	) + `<p style="margin:16px 0 0 0;">Online payment isn't switched on, so the invoice has no payment link.
	Raise one for this company from superadmin billing.</p>`
	Send(Message{
		To:      to,
		Subject: "Plan chosen, invoice needed: " + orgName,
		HTML: layout("A company wants to pay", html.EscapeString(orgName)+" chose a plan in the console.", body,
			"Open in superadmin", cfg.SuperadminURL+"/dashboard/billing", "Sent to the Aavishield team when a self-serve checkout needs a manual invoice."),
	})
}

// PaymentReceivedTeam tells the team a self-serve payment came in.
func PaymentReceivedTeam(to []string, orgName, planName string, seats int, amount string) {
	body := statTable(
		statRow("Company", orgName, ""),
		statRow("Plan", planName, ""),
		statRow("Devices", fmt.Sprint(seats), ""),
		statRow("Amount", amount, ""),
	)
	Send(Message{
		To:      to,
		Subject: "Self-serve payment: " + orgName + " (" + amount + ")",
		HTML: layout("New self-serve payment", html.EscapeString(orgName)+" paid online.", body,
			"Open in superadmin", cfg.SuperadminURL+"/dashboard/billing", "Sent to the Aavishield team for every self-serve payment."),
	})
}
