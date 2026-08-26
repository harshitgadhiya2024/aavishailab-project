package mailer

import (
	"fmt"
	"html"
	"strings"
)

// layout wraps content in the branded shell. Table-based and inline-styled on
// purpose: email clients ignore most modern CSS, and a dark-mode-only design
// would be unreadable in half of them.
func layout(heading, intro, body, ctaLabel, ctaURL, footer string) string {
	cta := ""
	if ctaLabel != "" && ctaURL != "" {
		cta = fmt.Sprintf(`
      <tr><td style="padding:8px 32px 24px 32px;">
        <a href="%s" style="display:inline-block;background:#FF7000;color:#ffffff;text-decoration:none;
           font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">%s</a>
      </td></tr>`, ctaURL, html.EscapeString(ctaLabel))
	}
	if footer == "" {
		footer = "You're receiving this because you use Delsecure to protect your organization."
	}

	return fmt.Sprintf(`<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb;">
          <span style="display:inline-block;width:28px;height:28px;background:#FF7000;border-radius:6px;
                       color:#fff;text-align:center;line-height:28px;font-weight:700;">D</span>
          <span style="font-size:16px;font-weight:700;color:#111827;margin-left:8px;vertical-align:middle;">Delsecure</span>
        </td></tr>
        <tr><td style="padding:28px 32px 8px 32px;">
          <h1 style="margin:0 0 12px 0;font-size:20px;color:#111827;">%s</h1>
          <p style="margin:0;font-size:14px;line-height:22px;color:#4b5563;">%s</p>
        </td></tr>
        <tr><td style="padding:16px 32px 0 32px;font-size:14px;line-height:22px;color:#4b5563;">%s</td></tr>
        %s
        <tr><td style="padding:20px 32px 28px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;line-height:18px;color:#9ca3af;">%s</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`, html.EscapeString(heading), intro, body, cta, footer)
}

// statRow renders one "label: value" line used by the digest emails.
func statRow(label, value, color string) string {
	if color == "" {
		color = "#111827"
	}
	return fmt.Sprintf(`<tr>
      <td style="padding:6px 0;font-size:13px;color:#6b7280;">%s</td>
      <td style="padding:6px 0;font-size:15px;font-weight:600;color:%s;text-align:right;">%s</td>
    </tr>`, html.EscapeString(label), color, html.EscapeString(value))
}

func statTable(rows ...string) string {
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#f9fafb;border-radius:8px;padding:8px 16px;margin:8px 0;">` +
		strings.Join(rows, "") + `</table>`
}

// ─── Account & access ─────────────────────────────────────────────────────────

// WelcomeOrg greets the first admin of a brand-new organization.
func WelcomeOrg(to, firstName, orgName string) {
	body := statTable(
		statRow("Organization", orgName, ""),
		statRow("Your role", "Administrator", ""),
	) + `<p style="margin:16px 0 0 0;">Next steps: add your employees, enrol their devices, then set the
	policies that decide what gets blocked.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "Welcome to Delsecure — " + orgName + " is ready",
		HTML: layout(
			"Welcome, "+html.EscapeString(firstName),
			"Your organization is set up and your dashboard is live.",
			body, "Open your dashboard", cfg.AppURL, ""),
	})
}

// InviteUser tells a new dashboard user their access is ready. The temporary
// password is included because it exists nowhere else — it is stored hashed.
func InviteUser(to, firstName, orgName, roleLabel, tempPassword, invitedBy string) {
	pw := ""
	if tempPassword != "" {
		pw = fmt.Sprintf(`<p style="margin:16px 0 0 0;">Sign in with this temporary password and change it straight away:</p>
	<p style="margin:8px 0 0 0;font-family:ui-monospace,Menlo,monospace;font-size:15px;background:#f3f4f6;
	   border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;display:inline-block;">%s</p>`,
			html.EscapeString(tempPassword))
	}
	body := statTable(
		statRow("Organization", orgName, ""),
		statRow("Your role", roleLabel, ""),
		statRow("Sign in with", to, ""),
	) + pw

	Send(Message{
		To:      []string{to},
		Subject: invitedBy + " added you to " + orgName + " on Delsecure",
		HTML: layout(
			"You have access to "+html.EscapeString(orgName),
			html.EscapeString(invitedBy)+" gave you access to the Delsecure security dashboard.",
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
		Subject: "Reset your Delsecure password",
		HTML: layout(
			"Reset your password",
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
		Subject: "Your Delsecure password was changed",
		HTML: layout(
			"Password changed",
			"Hi "+html.EscapeString(firstName)+", the password on your Delsecure account was just changed.",
			body, "Go to Delsecure", base, ""),
	})
}

// PortalAccessReady tells an employee their portal login works, after an admin
// sets their password for them.
func PortalAccessReady(to, firstName, orgName, tempPassword string) {
	pw := ""
	if tempPassword != "" {
		pw = fmt.Sprintf(`<p style="margin:16px 0 0 0;">Your temporary password:</p>
	<p style="margin:8px 0 0 0;font-family:ui-monospace,Menlo,monospace;font-size:15px;background:#f3f4f6;
	   border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;display:inline-block;">%s</p>`,
			html.EscapeString(tempPassword))
	}
	body := `<p style="margin:0;">From the portal you can see which sites were blocked for you, request access
	to something you need for work, and install the agent on a new device.</p>` + pw

	Send(Message{
		To:      []string{to},
		Subject: "Your " + orgName + " security portal access is ready",
		HTML: layout(
			"Hi "+html.EscapeString(firstName),
			html.EscapeString(orgName)+" has set up your employee security portal.",
			body, "Open the portal", cfg.PortalURL+"/login", ""),
	})
}

// ─── Access requests ──────────────────────────────────────────────────────────

// AccessRequestSubmitted tells admins someone is waiting on a decision.
func AccessRequestSubmitted(admins []string, employeeName, employeeEmail, domain, reason, policyName string) {
	if reason == "" {
		reason = "No reason given"
	}
	body := statTable(
		statRow("Employee", employeeName+" ("+employeeEmail+")", ""),
		statRow("Site", domain, ""),
		statRow("Blocked by", policyName, ""),
		statRow("Reason given", reason, ""),
	) + `<p style="margin:16px 0 0 0;">Approving grants this one employee access to this one site; it does not
	change the policy for anyone else.</p>`

	Send(Message{
		To:      admins,
		Subject: "Access request: " + employeeName + " wants " + domain,
		HTML: layout(
			"Access request waiting",
			html.EscapeString(employeeName)+" asked for access to a site your policies block.",
			body, "Review the request", cfg.AppURL+"/dashboard/access-requests", ""),
	})
}

// AccessRequestResolved tells the employee the outcome.
func AccessRequestResolved(to, firstName, domain string, approved bool, note string) {
	verdict := "approved"
	heading := "Access approved"
	intro := "You can now reach " + html.EscapeString(domain) + "."
	if !approved {
		verdict = "declined"
		heading = "Access declined"
		intro = "Your request for " + html.EscapeString(domain) + " was not approved."
	}
	rows := []string{statRow("Site", domain, ""), statRow("Decision", verdict, "")}
	if note != "" {
		rows = append(rows, statRow("Note", note, ""))
	}
	body := statTable(rows...)
	if approved {
		body += `<p style="margin:16px 0 0 0;">It may take a minute for your device to pick up the change.</p>`
	} else {
		body += `<p style="margin:16px 0 0 0;">If you need this site for work, reply to your IT team with more detail.</p>`
	}

	Send(Message{
		To:      []string{to},
		Subject: "Your access request for " + domain + " was " + verdict,
		HTML:    layout(heading, "Hi "+html.EscapeString(firstName)+". "+intro, body, "Open the portal", cfg.PortalURL, ""),
	})
}

// ─── Security notifications ───────────────────────────────────────────────────

// SecurityAlert is the immediate, high-severity notice: malware, or sensitive
// data actually blocked on its way out.
func SecurityAlert(admins []string, orgName, title, employeeName, target, detail string, riskScore int) {
	rows := []string{
		statRow("What happened", title, "#b91c1c"),
		statRow("Employee", employeeName, ""),
		statRow("Target", target, ""),
	}
	if riskScore > 0 {
		rows = append(rows, statRow("Risk score", fmt.Sprintf("%d/100", riskScore), "#b91c1c"))
	}
	if detail != "" {
		rows = append(rows, statRow("Detail", detail, ""))
	}

	Send(Message{
		To:      admins,
		Subject: "🔴 Security alert — " + title,
		HTML: layout(
			"Security alert",
			"Delsecure blocked something that needs your attention at "+html.EscapeString(orgName)+".",
			statTable(rows...), "Investigate in the dashboard", cfg.AppURL+"/dashboard/activity", ""),
	})
}

// ActivityDigest is the "several things piled up — come and look" email: the
// one an admin gets when incidents accumulate rather than one mail per event.
func ActivityDigest(admins []string, orgName string, hours int, blocked, alerted, dlp, malware, pendingRequests int, topDomains []string) {
	rows := []string{
		statRow("Blocked", fmt.Sprintf("%d", blocked), "#b91c1c"),
		statRow("Alerted", fmt.Sprintf("%d", alerted), "#b45309"),
	}
	if dlp > 0 {
		rows = append(rows, statRow("Sensitive-data incidents", fmt.Sprintf("%d", dlp), "#b45309"))
	}
	if malware > 0 {
		rows = append(rows, statRow("Malware detections", fmt.Sprintf("%d", malware), "#b91c1c"))
	}
	if pendingRequests > 0 {
		rows = append(rows, statRow("Access requests waiting", fmt.Sprintf("%d", pendingRequests), ""))
	}

	body := statTable(rows...)
	if len(topDomains) > 0 {
		body += `<p style="margin:16px 0 4px 0;font-weight:600;color:#111827;">Most-hit destinations</p><ul style="margin:0;padding-left:20px;color:#4b5563;font-size:14px;">`
		for _, d := range topDomains {
			body += "<li>" + html.EscapeString(d) + "</li>"
		}
		body += "</ul>"
	}

	window := fmt.Sprintf("%d hours", hours)
	if hours == 24 {
		window = "24 hours"
	}

	Send(Message{
		To:      admins,
		Subject: fmt.Sprintf("%d security incidents at %s need review", blocked+alerted, orgName),
		HTML: layout(
			"Activity worth a look",
			fmt.Sprintf("In the last %s, Delsecure recorded %d incidents at %s.",
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
		statRow("Days with no activity", fmt.Sprintf("%d", days), "#b45309"),
		statRow("Devices enrolled", fmt.Sprintf("%d", devices), ""),
		statRow("Devices online", fmt.Sprintf("%d", onlineDevices), ""),
	}
	reason := `<p style="margin:16px 0 0 0;">This usually means the agent stopped running, a device is switched
	off, or nothing was ever enrolled — not that everything is fine. Worth checking:</p>
	<ul style="margin:8px 0 0 0;padding-left:20px;color:#4b5563;font-size:14px;">
	  <li>Devices still show as online in the dashboard</li>
	  <li>The agent is installed on new machines</li>
	  <li>At least one policy is enabled</li>
	</ul>`

	Send(Message{
		To:      admins,
		Subject: "No security activity from " + orgName + " in " + fmt.Sprintf("%d days", days),
		HTML: layout(
			"Nothing has been reported",
			"Delsecure hasn't received any activity from "+html.EscapeString(orgName)+" recently.",
			statTable(rows...)+reason, "Check device status", cfg.AppURL+"/dashboard/devices",
			"You get this when reporting goes quiet, so silence is never mistaken for safety."),
	})
}

// EmployeeInactivityNotice nudges an employee whose device stopped reporting.
func EmployeeInactivityNotice(to, firstName, orgName string, days int) {
	body := `<p style="margin:0;">If you've stopped using that device, you can ignore this. Otherwise, check
	that the Delsecure agent is still running — while it isn't, you're browsing unprotected.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "Your device hasn't reported to " + orgName + " security in " + fmt.Sprintf("%d days", days),
		HTML: layout(
			"Your device has gone quiet",
			"Hi "+html.EscapeString(firstName)+", your device hasn't checked in with Delsecure for "+
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
		HTML: layout(
			"A device was enrolled",
			html.EscapeString(hostname)+" just registered with Delsecure.",
			body, "View devices", cfg.AppURL+"/dashboard/devices", ""),
	})
}

// WeeklySummary is the routine report — sent even in a quiet week, so admins
// always know the system is alive and what it did.
func WeeklySummary(admins []string, orgName string, blocked, alerted, dlp, employees, devices int, topDomains []string) {
	body := statTable(
		statRow("Blocked this week", fmt.Sprintf("%d", blocked), "#b91c1c"),
		statRow("Alerted this week", fmt.Sprintf("%d", alerted), "#b45309"),
		statRow("Sensitive-data incidents", fmt.Sprintf("%d", dlp), ""),
		statRow("Employees protected", fmt.Sprintf("%d", employees), ""),
		statRow("Devices enrolled", fmt.Sprintf("%d", devices), ""),
	)
	if len(topDomains) > 0 {
		body += `<p style="margin:16px 0 4px 0;font-weight:600;color:#111827;">Most-hit destinations</p><ul style="margin:0;padding-left:20px;color:#4b5563;font-size:14px;">`
		for _, d := range topDomains {
			body += "<li>" + html.EscapeString(d) + "</li>"
		}
		body += "</ul>"
	}
	if blocked+alerted == 0 {
		body += `<p style="margin:16px 0 0 0;">A quiet week — nothing was blocked or flagged. Your agents are
		still reporting, so this is genuine quiet rather than a gap in coverage.</p>`
	}

	Send(Message{
		To:      admins,
		Subject: "Weekly security summary — " + orgName,
		HTML: layout(
			"Your week in security",
			"Here's what Delsecure did for "+html.EscapeString(orgName)+" over the last seven days.",
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
		Subject: "Two-factor authentication is on for your Delsecure account",
		HTML: layout("Two-factor authentication enabled",
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
		HTML: layout("Two-factor authentication disabled",
			"Hi "+html.EscapeString(firstName)+", the second factor on your Delsecure account was removed.",
			body, "Turn it back on", cfg.AppURL+"/dashboard/profile", ""),
	})
}

// MFARecoveryCodeUsed flags a sign-in that bypassed the authenticator app.
func MFARecoveryCodeUsed(to, firstName string, codesLeft int, ip string) {
	body := statTable(
		statRow("Signed in from", ip, ""),
		statRow("Recovery codes left", fmt.Sprintf("%d", codesLeft), map[bool]string{true: "#b91c1c", false: ""}[codesLeft <= 2]),
	) + `<p style="margin:16px 0 0 0;">If this wasn't you, someone else has both your password and one of your
	recovery codes — change your password and regenerate your codes now.</p>`

	Send(Message{
		To:      []string{to},
		Subject: "A recovery code was used to sign in to your Delsecure account",
		HTML: layout("Recovery code used",
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
		HTML: layout("Set up two-factor authentication",
			"Hi "+html.EscapeString(firstName)+", "+html.EscapeString(orgName)+" has made a second factor mandatory for the security dashboard.",
			body, "Set it up now", cfg.AppURL+"/dashboard/profile", ""),
	})
}

// ─── One-time codes ───────────────────────────────────────────────────────────

// codeBlock renders the digits large enough to read off a phone at a glance.
func codeBlock(code string) string {
	return fmt.Sprintf(`<p style="margin:16px 0;font-family:ui-monospace,Menlo,monospace;font-size:30px;
	   letter-spacing:8px;font-weight:700;color:#111827;background:#f3f4f6;border:1px solid #e5e7eb;
	   border-radius:8px;padding:16px 20px;text-align:center;">%s</p>`, html.EscapeString(code))
}

// LoginCode is the sign-in code for accounts without an authenticator app.
func LoginCode(to, firstName, code string, validMinutes int) {
	body := codeBlock(code) + fmt.Sprintf(`<p style="margin:0;">This code expires in %d minutes and can be used once.
	If you didn't try to sign in, someone has your password — change it now.</p>`, validMinutes)

	Send(Message{
		To:      []string{to},
		Subject: code + " is your Delsecure sign-in code",
		HTML: layout("Your sign-in code",
			"Hi "+html.EscapeString(firstName)+", enter this code to finish signing in.",
			body, "", "",
			"Never share this code. Delsecure will never ask you for it."),
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
		Subject: code + " is your Delsecure verification code",
		HTML: layout("Confirm your email",
			greeting+", enter this code to finish creating your Delsecure account.",
			body, "", "",
			"If you didn't sign up for Delsecure, you can ignore this email."),
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
		`</strong> disconnected the Delsecure connector on <strong>` + html.EscapeString(hostname) +
		`</strong>.</p>
	<p style="margin:0;">That device is no longer being protected or monitored until it is connected
	again. The full history is on the Devices page.</p>`

	Send(Message{
		To:      admins,
		Subject: "Device disconnected — " + employeeName,
		HTML: layout("A device was disconnected",
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
	body := `<p style="margin:0 0 12px 0;">The Delsecure connector was removed from
	<strong>` + html.EscapeString(hostname) + `</strong>, used by <strong>` +
		html.EscapeString(employeeName) + `</strong>.</p>
	<p style="margin:0 0 12px 0;">Approved with the credentials of <strong>` +
		html.EscapeString(approvedBy) + `</strong>.</p>
	<p style="margin:0;">This device is no longer protected. If you did not expect this, review it
	on the Devices page.</p>`

	Send(Message{
		To:      admins,
		Subject: "Connector uninstalled — " + hostname,
		HTML: layout("A connector was uninstalled",
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
		`</strong> connected the Delsecure connector on <strong>` + html.EscapeString(hostname) +
		`</strong>. That device is protected again.</p>`

	Send(Message{
		To:      admins,
		Subject: "Device connected — " + employeeName,
		HTML: layout("A device was connected",
			employeeName+" connected on "+when+".",
			body, "View devices", cfg.AppURL+"/dashboard/devices", ""),
	})
}
