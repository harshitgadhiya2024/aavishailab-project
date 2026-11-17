package mailer

import (
	"fmt"
	"html"
	"strings"
)

// logoURL is the hosted Aavishield logo shown at the top of every email. The
// company dashboard serves it from /brand; MAIL_LOGO_URL overrides it.
func logoURL() string {
	return envOr("MAIL_LOGO_URL", "https://app.aavishield.com/brand/logo-email.png")
}

// ─── Account & access ─────────────────────────────────────────────────────────

// InviteUser tells a new dashboard user their access is ready. The temporary
// password is included because it exists nowhere else — it is stored hashed.
func InviteUser(to, firstName, orgName, roleLabel, tempPassword, invitedBy string) {
	pw := ""
	if tempPassword != "" {
		pw = secretBox("Temporary password — change it after signing in", tempPassword)
	}
	body := statTable(
		statRow("Organization", orgName, ""),
		statRow("Your role", roleLabel, ""),
		statRow("Sign in with", to, ""),
	) + pw

	Send(Message{
		To:      []string{to},
		Subject: invitedBy + " added you to " + orgName + " on Aavishield",
		HTML: layout(kTeamAccess,
			"You have access to ^"+orgName,
			html.EscapeString(invitedBy)+" gave you access to the Aavishield security dashboard.",
			body, "Sign in", cfg.AppURL+"/login", ""),
	})
}

// PasswordReset sends the reset link. The token is single-use and short-lived.
func PasswordReset(to, firstName, token string, portal bool) {
	base := cfg.AppURL
	if portal {
		base = cfg.PortalURL
	}
	link := fmt.Sprintf("%s/reset-password?token=%s", base, token)

	body := `<p style="margin:0;">This link works once and expires in an hour. If you didn't ask to reset
	your password, you can ignore this email — nothing has changed.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "Reset your Aavishield password",
		HTML: layout(kAccount,
			"Reset your ^password",
			"Hi "+html.EscapeString(firstName)+", use the button below to choose a new password.",
			body, "Reset password", link, ""),
	})
}

// PasswordChanged is the "was this you?" confirmation.
func PasswordChanged(to, firstName string, portal bool) {
	base := cfg.AppURL
	if portal {
		base = cfg.PortalURL
	}
	body := `<p style="margin:0;">If this wasn't you, reset your password immediately and tell your IT
	administrator — someone else may have access to your account.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "Your Aavishield password was changed",
		HTML: layout(kAccountWarn,
			"Your password ^was changed",
			"Hi "+html.EscapeString(firstName)+", the password on your Aavishield account was just changed.",
			body, "Go to Aavishield", base, ""),
	})
}

// PortalAccessReady tells an employee their portal login works, after an admin
// sets their password for them.
func PortalAccessReady(to, firstName, orgName, tempPassword string) {
	pw := ""
	if tempPassword != "" {
		pw = secretBox("Your temporary password", tempPassword)
	}
	body := `<p style="margin:0;">From the portal you can see which sites were blocked for you, request access
	to something you need for work, and install the agent on a new device.</p>` + pw

	Send(Message{
		To:      []string{to},
		Subject: "Your " + orgName + " security portal access is ready",
		HTML: layout(kPortal,
			"Hi "+firstName+". ^Your portal is ready.",
			html.EscapeString(orgName)+" has set up your employee security portal.",
			body, "Open the portal", cfg.PortalURL+"/login", ""),
	})
}

// ─── Access requests ──────────────────────────────────────────────────────────

// AccessRequestSubmitted tells admins someone is waiting on a decision.
// kind is the request's noun ("Website", "Application", ...), what the thing
// asked for, blockedBy the policy or control that stopped it.
func AccessRequestSubmitted(admins []string, employeeName, employeeEmail, kind, what, reason, blockedBy string) {
	if reason == "" {
		reason = "No reason given"
	}
	rows := []string{
		statRow("Employee", employeeName+" ("+employeeEmail+")", ""),
		statRow(kind, what, ""),
	}
	if blockedBy != "" {
		rows = append(rows, statRow("Stopped by", blockedBy, ""))
	}
	rows = append(rows, statRow("Reason given", reason, ""))
	body := statTable(rows...) + `<p style="margin:16px 0 0 0;">Approving grants this one employee this one exception; it does not
	change the policy for anyone else, and you can revoke it at any time.</p>`

	Send(Message{
		To:      admins,
		Subject: "Access request: " + employeeName + " wants " + what,
		HTML: layout(kAccessReq,
			"An access request is ^waiting",
			html.EscapeString(employeeName)+" asked for an exception to your security policy.",
			body, "Review the request", cfg.AppURL+"/dashboard/access-requests", ""),
	})
}

// AccessRequestResolved tells the employee the outcome. outcome is the new
// status: approved, denied or revoked.
func AccessRequestResolved(to, firstName, kind, what, outcome, note string) {
	var heading, intro, verdict, after string
	k := kAccessReq
	k.tone = toneDanger
	switch outcome {
	case "approved":
		k.tone = toneSuccess
		verdict, heading = "approved", "Access ^approved"
		intro = "Your company approved your request for " + html.EscapeString(what) + "."
		after = "It can take up to a minute for your device to pick up the change."
	case "revoked":
		k.tone = toneWarning
		verdict, heading = "revoked", "Access ^revoked"
		intro = "Your company took back the access it had given you for " + html.EscapeString(what) + "."
		after = "Your device will apply the policy again within a minute."
	default:
		verdict, heading = "declined", "Access ^declined"
		intro = "Your request for " + html.EscapeString(what) + " was not approved."
		after = "If you need it for work, talk to your IT team with more detail."
	}
	rows := []string{statRow(kind, what, ""), statRow("Decision", verdict, "")}
	if note != "" {
		rows = append(rows, statRow("Note from your company", note, ""))
	}
	body := statTable(rows...) + `<p style="margin:16px 0 0 0;">` + after + `</p>`

	Send(Message{
		To:      []string{to},
		Subject: "Your access request for " + what + " was " + verdict,
		HTML:    layout(k, heading, "Hi "+html.EscapeString(firstName)+". "+intro, body, "Open the portal", cfg.PortalURL, ""),
	})
}

// ─── Security notifications ───────────────────────────────────────────────────

// SecurityAlert is the immediate, high-severity notice: malware, or sensitive
// data actually blocked on its way out.
func SecurityAlert(admins []string, orgName, title, employeeName, target, detail string, riskScore int) {
	rows := []string{
		statRow("What happened", title, colorDanger),
		statRow("Employee", employeeName, ""),
		statRow("Target", target, ""),
	}
	if riskScore > 0 {
		rows = append(rows, statRow("Risk score", fmt.Sprintf("%d/100", riskScore), colorDanger))
	}
	if detail != "" {
		rows = append(rows, statRow("Detail", detail, ""))
	}

	Send(Message{
		To:      admins,
		Subject: "🔴 Security alert — " + title,
		HTML: layout(kAlert,
			"Aavishield ^blocked a threat",
			"Aavishield blocked something that needs your attention at "+html.EscapeString(orgName)+".",
			statTable(rows...), "Investigate in the dashboard", cfg.AppURL+"/dashboard/activity", ""),
	})
}

// ActivityDigest is the "several things piled up — come and look" email: the
// one an admin gets when incidents accumulate rather than one mail per event.
func ActivityDigest(admins []string, orgName string, hours int, blocked, alerted, dlp, malware, pendingRequests int, topDomains []string) {
	rows := []string{
		statRow("Blocked", fmt.Sprintf("%d", blocked), colorDanger),
		statRow("Alerted", fmt.Sprintf("%d", alerted), colorWarning),
	}
	if dlp > 0 {
		rows = append(rows, statRow("Sensitive-data incidents", fmt.Sprintf("%d", dlp), colorWarning))
	}
	if malware > 0 {
		rows = append(rows, statRow("Malware detections", fmt.Sprintf("%d", malware), colorDanger))
	}
	if pendingRequests > 0 {
		rows = append(rows, statRow("Access requests waiting", fmt.Sprintf("%d", pendingRequests), ""))
	}

	body := statTable(rows...)
	if len(topDomains) > 0 {
		body += sectionTitle("Most-hit destinations") + bulletList(escapeAll(topDomains)...)
	}

	window := fmt.Sprintf("%d hours", hours)
	if hours == 24 {
		window = "24 hours"
	}

	Send(Message{
		To:      admins,
		Subject: fmt.Sprintf("%d security incidents at %s need review", blocked+alerted, orgName),
		HTML: layout(kDigest,
			"Activity ^worth a look",
			fmt.Sprintf("In the last %s, Aavishield recorded %d incidents at %s.",
				window, blocked+alerted, html.EscapeString(orgName)),
			body, "Review in the dashboard", cfg.AppURL+"/dashboard/activity",
			"You get this when incidents build up — not one email per event."),
	})
}

// NoActivityNotice fires when a protected organization has gone quiet. Silence
// usually means agents stopped reporting, which looks identical to "a safe
// week" on the dashboard — so it's worth saying out loud.
func NoActivityNotice(admins []string, orgName string, days int, devices, onlineDevices int) {
	rows := []string{
		statRow("Days with no activity", fmt.Sprintf("%d", days), colorWarning),
		statRow("Devices enrolled", fmt.Sprintf("%d", devices), ""),
		statRow("Devices online", fmt.Sprintf("%d", onlineDevices), ""),
	}
	reason := `<p style="margin:16px 0 0 0;">This usually means the agent stopped running, a device is switched
	off, or nothing was ever enrolled — not that everything is fine. Worth checking:</p>` + bulletList(
		"Devices still show as online in the dashboard",
		"The agent is installed on new machines",
		"At least one policy is enabled",
	)

	Send(Message{
		To:      admins,
		Subject: "No security activity from " + orgName + " in " + fmt.Sprintf("%d days", days),
		HTML: layout(kCoverage,
			"Nothing has been ^reported",
			"Aavishield hasn't received any activity from "+html.EscapeString(orgName)+" recently.",
			statTable(rows...)+reason, "Check device status", cfg.AppURL+"/dashboard/devices",
			"You get this when reporting goes quiet, so silence is never mistaken for safety."),
	})
}

// EmployeeInactivityNotice nudges an employee whose device stopped reporting.
func EmployeeInactivityNotice(to, firstName, orgName string, days int) {
	body := `<p style="margin:0;">If you've stopped using that device, you can ignore this. Otherwise, check
	that the Aavishield agent is still running — while it isn't, you're browsing unprotected.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "Your device hasn't reported to " + orgName + " security in " + fmt.Sprintf("%d days", days),
		HTML: layout(kCoverage,
			"Your device has ^gone quiet",
			"Hi "+html.EscapeString(firstName)+", your device hasn't checked in with Aavishield for "+
				fmt.Sprintf("%d days", days)+".",
			body, "Open the portal", cfg.PortalURL, ""),
	})
}

// DeviceEnrolled confirms a new machine joined the estate — the cheapest way to
// notice an enrolment nobody authorised.
func DeviceEnrolled(admins []string, orgName, hostname, employeeName, osType string) {
	body := statTable(
		statRow("Device", hostname, ""),
		statRow("Assigned to", employeeName, ""),
		statRow("Operating system", osType, ""),
	) + `<p style="margin:16px 0 0 0;">If you weren't expecting this enrolment, revoke the device from the
	dashboard straight away.</p>`

	Send(Message{
		To:      admins,
		Subject: "New device enrolled at " + orgName + ": " + hostname,
		HTML: layout(kDevices,
			"A new device ^joined",
			html.EscapeString(hostname)+" just registered with Aavishield.",
			body, "View devices", cfg.AppURL+"/dashboard/devices", ""),
	})
}

// WeeklySummary is the routine report — sent even in a quiet week, so admins
// always know the system is alive and what it did.
func WeeklySummary(admins []string, orgName string, blocked, alerted, dlp, employees, devices int, topDomains []string) {
	body := statTable(
		statRow("Blocked this week", fmt.Sprintf("%d", blocked), colorDanger),
		statRow("Alerted this week", fmt.Sprintf("%d", alerted), colorWarning),
		statRow("Sensitive-data incidents", fmt.Sprintf("%d", dlp), ""),
		statRow("Employees protected", fmt.Sprintf("%d", employees), ""),
		statRow("Devices enrolled", fmt.Sprintf("%d", devices), ""),
	)
	if len(topDomains) > 0 {
		body += sectionTitle("Most-hit destinations") + bulletList(escapeAll(topDomains)...)
	}
	if blocked+alerted == 0 {
		body += `<p style="margin:16px 0 0 0;">A quiet week — nothing was blocked or flagged. Your agents are
		still reporting, so this is genuine quiet rather than a gap in coverage.</p>`
	}

	Send(Message{
		To:      admins,
		Subject: "Weekly security summary — " + orgName,
		HTML: layout(kWeekly,
			"Your week ^in security",
			"Here's what Aavishield did for "+html.EscapeString(orgName)+" over the last seven days.",
			body, "Open full reports", cfg.AppURL+"/dashboard/reports",
			"Sent weekly, whether or not anything happened."),
	})
}

// ─── Multi-factor authentication ──────────────────────────────────────────────

// MFAEnabled confirms a second factor was added. If the account holder didn't
// do it, this email is how they find out someone else has their password.
func MFAEnabled(to, firstName string) {
	body := `<p style="margin:0;">From now on you'll be asked for a 6-digit code from your authenticator app
	when you sign in. If you didn't set this up, reset your password immediately.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "Two-factor authentication is on for your Aavishield account",
		HTML: layout(kMFAOn, "Two-factor is ^on",
			"Hi "+html.EscapeString(firstName)+", your account is now protected by a second factor.",
			body, "Review account security", cfg.AppURL+"/dashboard/profile", ""),
	})
}

// MFADisabled reports the removal of a second factor — the more security-
// relevant direction of the two.
func MFADisabled(to, firstName string) {
	body := `<p style="margin:0;">Your account is now protected by a password alone. If you didn't do this,
	change your password and turn two-factor authentication back on straight away.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "Two-factor authentication was turned off",
		HTML: layout(kMFAOff, "Two-factor was ^turned off",
			"Hi "+html.EscapeString(firstName)+", the second factor on your Aavishield account was removed.",
			body, "Turn it back on", cfg.AppURL+"/dashboard/profile", ""),
	})
}

// MFARecoveryCodeUsed flags a sign-in that bypassed the authenticator app.
func MFARecoveryCodeUsed(to, firstName string, codesLeft int, ip string) {
	body := statTable(
		statRow("Signed in from", ip, ""),
		statRow("Recovery codes left", fmt.Sprintf("%d", codesLeft), map[bool]string{true: colorDanger, false: ""}[codesLeft <= 2]),
	) + `<p style="margin:16px 0 0 0;">If this wasn't you, someone else has both your password and one of your
	recovery codes — change your password and regenerate your codes now.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "A recovery code was used to sign in to your Aavishield account",
		HTML: layout(kSignIn, "A recovery code ^was used",
			"Hi "+html.EscapeString(firstName)+", someone signed in using one of your backup codes instead of your authenticator app.",
			body, "Review account security", cfg.AppURL+"/dashboard/profile", ""),
	})
}

// MFARequired tells a user their organization now mandates a second factor,
// before they hit the wall at their next sign-in.
func MFARequired(to, firstName, orgName string) {
	body := `<p style="margin:0;">The next time you sign in you'll be asked to set it up — it takes about a
	minute with any authenticator app (Google Authenticator, 1Password, Authy, Microsoft Authenticator).</p>`

	Send(Message{
		To:      []string{to},
		Subject: orgName + " now requires two-factor authentication",
		HTML: layout(kMFA, "Set up ^two-factor",
			"Hi "+html.EscapeString(firstName)+", "+html.EscapeString(orgName)+" has made a second factor mandatory for the security dashboard.",
			body, "Set it up now", cfg.AppURL+"/dashboard/profile", ""),
	})
}

// ─── One-time codes ───────────────────────────────────────────────────────────

// LoginCode is the sign-in code for accounts without an authenticator app.
func LoginCode(to, firstName, code string, validMinutes int) {
	body := codeBlock(code) + fmt.Sprintf(`<p style="margin:0;">This code expires in %d minutes and can be used once.
	If you didn't try to sign in, someone has your password — change it now.</p>`, validMinutes)

	Send(Message{
		To:      []string{to},
		Subject: code + " is your Aavishield sign-in code",
		HTML: layout(kCode, "Your sign-in ^code",
			"Hi "+html.EscapeString(firstName)+", enter this code to finish signing in.",
			body, "", "",
			"Never share this code. Aavishield will never ask you for it."),
	})
}

// RegistrationCode proves an address belongs to whoever is signing up. No
// organization exists until this code comes back.
func RegistrationCode(to, firstName, code string, validMinutes int) {
	greeting := "Welcome"
	if strings.TrimSpace(firstName) != "" {
		greeting = "Hi " + html.EscapeString(firstName)
	}
	body := codeBlock(code) + fmt.Sprintf(`<p style="margin:0;">This code expires in %d minutes. Your account and
	organization are created once you enter it — nothing is saved before then.</p>`, validMinutes)

	Send(Message{
		To:      []string{to},
		Subject: code + " is your Aavishield verification code",
		HTML: layout(kVerify, "Confirm your ^email",
			greeting+", enter this code to finish creating your Aavishield account.",
			body, "", "",
			"If you didn't sign up for Aavishield, you can ignore this email."),
	})
}

// ─── Device lifecycle ─────────────────────────────────────────────────────────
//
// These three go to the company's admins, not the employee: the point is that
// somebody accountable learns a device stopped being protected. Disconnect and
// uninstall are the two ways coverage ends, so they are reported even though
// both are permitted actions — this is an audit trail, not an alarm.

// DeviceDisconnected tells the company an employee disconnected the connector.
func DeviceDisconnected(admins []string, orgName, employeeName, hostname, when string) {
	if len(admins) == 0 {
		return
	}
	body := `<p style="margin:0 0 12px 0;"><strong>` + html.EscapeString(employeeName) +
		`</strong> disconnected the Aavishield connector on <strong>` + html.EscapeString(hostname) +
		`</strong>.</p>
	<p style="margin:0;">That device is no longer being protected or monitored until it is connected
	again. The full history is on the Devices page.</p>`

	Send(Message{
		To:      admins,
		Subject: "Device disconnected — " + employeeName,
		HTML: layout(kDevicesWarn, "A device ^disconnected",
			employeeName+" disconnected on "+when+".",
			body, "View devices", cfg.AppURL+"/dashboard/devices", ""),
	})
}

// DeviceUninstalled reports a removal. Uninstalling needs a company
// administrator's password, so this doubles as a record of that approval.
func DeviceUninstalled(admins []string, orgName, employeeName, hostname, approvedBy, when string) {
	if len(admins) == 0 {
		return
	}
	body := `<p style="margin:0 0 12px 0;">The Aavishield connector was removed from
	<strong>` + html.EscapeString(hostname) + `</strong>, used by <strong>` +
		html.EscapeString(employeeName) + `</strong>.</p>
	<p style="margin:0 0 12px 0;">Approved with the credentials of <strong>` +
		html.EscapeString(approvedBy) + `</strong>.</p>
	<p style="margin:0;">This device is no longer protected. If you did not expect this, review it
	on the Devices page.</p>`

	Send(Message{
		To:      admins,
		Subject: "Connector uninstalled — " + hostname,
		HTML: layout(kDevicesBad, "A connector was ^uninstalled",
			"Removed on "+when+", approved by "+approvedBy+".",
			body, "View devices", cfg.AppURL+"/dashboard/devices", ""),
	})
}

// DeviceConnected is the counterpart to DeviceDisconnected, so the trail shows
// coverage resuming and not only when it stopped.
func DeviceConnected(admins []string, orgName, employeeName, hostname, when string) {
	if len(admins) == 0 {
		return
	}
	body := `<p style="margin:0;"><strong>` + html.EscapeString(employeeName) +
		`</strong> connected the Aavishield connector on <strong>` + html.EscapeString(hostname) +
		`</strong>. That device is protected again.</p>`

	Send(Message{
		To:      admins,
		Subject: "Device connected — " + employeeName,
		HTML: layout(kDevicesOK, "A device is ^protected again",
			employeeName+" connected on "+when+".",
			body, "View devices", cfg.AppURL+"/dashboard/devices", ""),
	})
}

// ─── Website demo requests ────────────────────────────────────────────────────

// DemoRequestReceived tells the team a new "Book a demo" form came in from
// the marketing site. Reply-worthy details are in the body so it can be
// actioned straight from the inbox.
func DemoRequestReceived(to []string, name, email, company, devices, note, source string) {
	if devices == "" {
		devices = "Not given"
	}
	if note == "" {
		note = "No message"
	}
	body := statTable(
		statRow("Name", name, ""),
		statRow("Work email", email, ""),
		statRow("Company", company, ""),
		statRow("Devices", devices, ""),
		statRow("Submitted from", source, ""),
	) + sectionTitle("What they want to see") +
		messageCard(message{author: name, role: "Demo request · " + company, body: note}) +
		fmt.Sprintf(`<p style="margin:16px 0 0 0;">Reply to <a href="mailto:%s" style="color:#c2410c;">%s</a> to schedule the demo.</p>`,
			html.EscapeString(email), html.EscapeString(email))

	Send(Message{
		To:      to,
		Subject: "New demo request: " + company + " (" + name + ")",
		HTML: layout(kLead,
			"New demo ^request",
			html.EscapeString(name)+" from "+html.EscapeString(company)+" booked a demo on the website.",
			body, "Open in superadmin", cfg.SuperadminURL+"/dashboard/demo-requests",
			"Sent to the Aavishield team for every demo request from the website."),
	})
}

// DemoRequestConfirmation acknowledges the request to the person who sent it.
func DemoRequestConfirmation(to, name string) {
	body := `<p style="margin:0;">Someone from our team will reply within one business day to find a time
	that suits you. The demo takes about thirty minutes and runs on real devices, not slides.</p>
	<p style="margin:16px 0 0 0;">If you have anything to add in the meantime, just reply to this email.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "We received your Aavishield demo request",
		HTML: layout(kDemo,
			"Thanks, "+name+". ^We'll be in touch.",
			"Your demo request reached the Aavishield team.",
			body, "", "",
			"You're receiving this because you booked a demo on aavishield.com."),
	})
}

// DemoBookedConfirmation confirms a demo booked (or moved) from the company
// console, with a calendar invite that adds it to the customer's calendar or
// moves the event already there. when is formatted in the customer's zone.
func DemoBookedConfirmation(to, name, when string, invite DemoInvite) {
	body := fmt.Sprintf(`<p style="margin:0;">Your 30-minute Aavishield demo is booked for <strong>%s</strong>.</p>
	<p style="margin:16px 0 0 0;">It's on your calendar with this email. We'll send a meeting link before the call.
	We'll walk through your own console and the controls you picked, and answer questions about rolling it out to your team.</p>
	<p style="margin:16px 0 0 0;">Need a different time? Use Book a demo in your console again.</p>`, html.EscapeString(when))

	Send(Message{
		To:      []string{to},
		Subject: "Your Aavishield demo: " + when,
		HTML: layout(kDemoBooked,
			"See you soon, ^"+name+".",
			"Your demo with the Aavishield team is booked.",
			body, "", "",
			"You're receiving this because you booked a demo from your Aavishield console."),
		Calendar: invite.part(),
	})
}

// ─── Prelaunch waitlist ──────────────────────────────────────────────────────

// WaitlistJoined tells the team about a new sign-up (only when
// WAITLIST_NOTIFY_EMAIL is set; see handlers.WaitlistHandler.Submit).
func WaitlistJoined(to []string, name, email, company, teamSize, role, source string) {
	if teamSize == "" {
		teamSize = "Not given"
	}
	if role == "" {
		role = "Not given"
	}
	body := statTable(
		statRow("Name", name, ""),
		statRow("Work email", email, ""),
		statRow("Company", company, ""),
		statRow("Team size", teamSize, ""),
		statRow("Role", role, ""),
		statRow("Signed up from", source, ""),
	)
	Send(Message{
		To:      to,
		Subject: "New waitlist sign-up: " + company + " (" + name + ")",
		HTML: layout(kWaitlist,
			"New waitlist ^sign-up",
			html.EscapeString(name)+" from "+html.EscapeString(company)+" joined the Aavishield waitlist.",
			body, "Open the waitlist", cfg.SuperadminURL+"/dashboard/waitlist",
			"Sent to the Aavishield team for every waitlist sign-up."),
	})
}

// WaitlistConfirmation acknowledges a sign-up to the person who joined.
func WaitlistConfirmation(to, name string) {
	body := `<p style="margin:0;">We're opening Aavishield to teams in small groups, so we can set
	each one up properly. We'll email you as soon as your spot opens.</p>
	<p style="margin:16px 0 0 0;">Have a question or a deadline we should know about? Just reply to this email.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "You're on the Aavishield waitlist",
		HTML: layout(kEarly,
			"You're on the list, ^"+name+".",
			"Thanks for joining the Aavishield early access waitlist.",
			body, "", "",
			"You're receiving this because you joined the waitlist on aavishield.com."),
	})
}

// WaitlistInvite is sent the first time a superadmin moves a sign-up to
// "invited": their spot is open, so they can create their organization.
func WaitlistInvite(to, name string) {
	body := `<p style="margin:0;">Your early access spot is open. Create your organization to get
	started: it takes a few minutes, then you can add your team and install the agent on the first laptop.</p>
	<p style="margin:16px 0 0 0;">Reply to this email any time if you'd like a hand with setup.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "Your Aavishield early access is ready",
		HTML: layout(kEarlyOpen,
			"You're in, ^"+name+".",
			"Your spot on the Aavishield early access program is ready.",
			body, "Create your organization", cfg.AppURL+"/register",
			"You're receiving this because you joined the Aavishield waitlist."),
	})
}

// ─── Data residency ───────────────────────────────────────────────────────────

// DataStoreUnreachable tells admins their own database or bucket stopped
// answering. what is "database" or "file storage".
func DataStoreUnreachable(admins []string, orgName, what, detail string) {
	body := `<p style="margin:0;">While it is unreachable:</p>` + bulletList(
		"The dashboard can't show activity, reports or screenshots.",
		"New security events are held encrypted for up to 72 hours and delivered automatically once it is back. Screenshots taken meanwhile are not kept.",
		"Nothing is written to Aavishield's own storage instead.",
	) + `<p style="margin:16px 0 0 0;font-size:13px;color:#5d5d66;">Last error: ` + html.EscapeString(detail) + `</p>`
	Send(Message{
		To:      admins,
		Subject: "Action needed: Aavishield can't reach your " + what,
		HTML: layout(kResidency,
			"Your "+what+" is ^unreachable",
			html.EscapeString(orgName)+" keeps employee data in its own "+html.EscapeString(what)+", and Aavishield could not connect to it.",
			body, "Check the connection", cfg.AppURL+"/dashboard/settings#data-residency",
			"You get this because your organization stores its data on its own infrastructure."),
	})
}

// DataStoreRecovered is the all-clear after DataStoreUnreachable.
func DataStoreRecovered(admins []string, orgName, what string) {
	Send(Message{
		To:      admins,
		Subject: "Resolved: Aavishield is connected to your " + what + " again",
		HTML: layout(kResidencyOK,
			"Your "+what+" is ^back online",
			"Aavishield can reach "+html.EscapeString(orgName)+"'s "+html.EscapeString(what)+" again. Any held security events are being delivered to it now.",
			"", "Open settings", cfg.AppURL+"/dashboard/settings#data-residency", ""),
	})
}
