package mailer

import (
	"fmt"
	"html"
	"strings"
	"time"
)

// Website-style email building blocks. They mirror aavishield.com rather than
// a generic "card" email:
//
//   - one frame with hairline rails, split into bands by hairlines that end
//     in dark 12px crosshairs sitting exactly on the rails (.grid-band);
//   - light-weight Satoshi headlines with orange highlight words;
//   - orange DM Mono eyebrows with a square marker;
//   - orange / outlined uppercase mono buttons;
//   - the dithered pixel terrain (dither-field.tsx) behind the hero card, the
//     closing call to action and the end of the footer. Email clients can't
//     run the canvas, so cmd/email-assets renders the same algorithm to PNGs.
//
// Everything is table-based and inline-styled so it survives Gmail and
// Outlook; web fonts load where supported and fall back to system fonts.

const (
	siteBg     = "#fafafa"
	siteRail   = "#e6e6e8" // rgb(11 11 13 / .09) on #fafafa
	siteCross  = "#6c6c70" // rgb(11 11 13 / .6) on #fafafa, the crosshairs
	siteGutter = 6         // half a crosshair: the rails sit this far in
)

// assetURL is where the email images are hosted. The company dashboard serves
// frontend/company-dashboard/public/brand at /brand.
func assetURL(name string) string {
	return strings.TrimRight(envOr("MAIL_ASSET_URL", "https://app.aavishield.com/brand"), "/") + "/" + name
}

// px is an empty, fixed-size table cell, optionally filled with a colour.
func px(w, h int, color string) string {
	bg := ""
	if color != "" {
		bg = fmt.Sprintf(` bgcolor="%s"`, color)
	}
	style := fmt.Sprintf("font-size:0;line-height:0;mso-line-height-rule:exactly;height:%dpx;", h)
	if w > 0 {
		style += fmt.Sprintf("width:%dpx;", w)
	}
	if color != "" {
		style += "background:" + color + ";"
	}
	wa := ""
	if w > 0 {
		wa = fmt.Sprintf(` width="%d"`, w)
	}
	return fmt.Sprintf(`<td%s height="%d"%s style="%s"></td>`, wa, h, bg, style)
}

// siteDivider is the hairline between bands, with a 12px crosshair centred on
// each rail like the website's .grid-band::before/::after.
func siteDivider() string {
	g := siteGutter
	arm := func() string { // a row above or below the horizontal line
		h := 5
		return "<tr>" + px(g, h, "") + px(1, h, siteCross) + px(g-1, h, "") + px(0, h, "") +
			px(g-1, h, "") + px(1, h, siteCross) + px(g, h, "") + "</tr>"
	}
	line := "<tr>" + px(g, 1, siteCross) + px(1, 1, siteCross) + px(g-1, 1, siteCross) + px(0, 1, siteRail) +
		px(g-1, 1, siteCross) + px(1, 1, siteCross) + px(g, 1, siteCross) + "</tr>"
	return `
<tr><td style="padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">` +
		arm() + line + arm() + `</table>
</td></tr>`
}

// siteBand wraps one section in the framed column between the two rails.
func siteBand(inner string) string {
	return fmt.Sprintf(`
<tr><td style="padding:0 %dpx;">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"
         style="background:%s;border-left:1px solid %s;border-right:1px solid %s;">%s
  </table>
</td></tr>`, siteGutter, siteBg, siteRail, siteRail, inner)
}

// terrainCell opens a <td> with the pixel terrain anchored to its bottom
// edge. Clients without background images just show the plain page colour.
func terrainCell(image, extraStyle string) string {
	u := html.EscapeString(assetURL(image))
	// No background colour: the band behind is already the page colour, and a
	// painted cell would clip the shadow of a card in the row above.
	return fmt.Sprintf(`<td background="%s" style="background-image:url('%s');background-repeat:no-repeat;background-position:center bottom;background-size:100%% auto;%s">`,
		u, u, extraStyle)
}

// siteEyebrow is the orange "■ LABEL" line above a headline.
func siteEyebrow(label string) string {
	return fmt.Sprintf(`<p style="margin:0 0 18px 0;font-family:%s;font-size:11px;line-height:16px;letter-spacing:1.3px;text-transform:uppercase;color:%s;">
  <span style="display:inline-block;width:6px;height:6px;background:%s;vertical-align:middle;margin:-2px 8px 0 0;"></span>%s</p>`,
		fontMono, colorBrandInk, colorBrand, html.EscapeString(label))
}

// siteHeadline renders a Satoshi headline at weight 400. accent is appended in
// brand orange, like "the same security <as the office.>" on the site.
func siteHeadline(text, accent string, size int) string {
	ls := float64(size) * -0.04
	acc := ""
	if accent != "" {
		acc = fmt.Sprintf(` <span style="color:%s;">%s</span>`, colorBrand, html.EscapeString(accent))
	}
	return fmt.Sprintf(`<h1 class="h1" style="margin:0;font-family:%s;font-size:%dpx;line-height:%dpx;font-weight:400;letter-spacing:%.1fpx;color:%s;">%s%s</h1>`,
		fontDisplay, size, size+2, ls, colorInk, html.EscapeString(text), acc)
}

// siteButton is the orange (primary) or outlined (ghost) mono button.
func siteButton(label, url string, primary bool) string {
	bg, fg, border := colorBrand, "#ffffff", colorBrand
	arrow := "&#8599;" // ↗, as on the site
	if !primary {
		bg, fg, border = siteBg, colorInk, "#a9a9ae"
		arrow = "&#8594;"
	}
	return fmt.Sprintf(`<td bgcolor="%s" style="background:%s;border:1px solid %s;border-radius:6px;">
  <a href="%s" target="_blank" style="display:inline-block;padding:11px 16px;font-family:%s;font-size:12px;line-height:18px;
     font-weight:500;letter-spacing:0.7px;text-transform:uppercase;color:%s;text-decoration:none;white-space:nowrap;">%s&nbsp;&nbsp;%s</a>
</td>`, bg, bg, border, html.EscapeString(url), fontMono, fg, html.EscapeString(label), arrow)
}

// sitePage is the shell: the logo bar, the caller's bands separated by
// crosshair dividers, then the website-style footer ending in the terrain.
// Each section is one or more <tr> rows for the framed column.
//
// reason is the trusted-HTML "why you got this" line shown in the footer.
func sitePage(title, preview, reason string, sections ...string) string {
	site := siteURL()

	header := fmt.Sprintf(`
<tr><td class="px" style="padding:20px 32px;">
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle">
      <a href="%s" target="_blank" style="text-decoration:none;">
        <img src="%s" width="120" height="40" alt="Aavishield"
             style="display:block;border:0;outline:none;width:120px;height:40px;font-family:%s;font-size:20px;color:%s;">
      </a>
    </td>
    <td align="right" valign="middle">
      <a href="%s/login" target="_blank" style="display:inline-block;padding:7px 12px;background:#ffffff;border:1px solid #d4d4d8;border-radius:6px;
         font-family:%s;font-size:11px;line-height:16px;letter-spacing:0.7px;text-transform:uppercase;color:%s;text-decoration:none;">&#8594;&nbsp;Sign in</a>
    </td>
  </tr></table>
</td></tr>`, html.EscapeString(site), html.EscapeString(logoURL()), fontDisplay, colorInk,
		html.EscapeString(cfg.AppURL), fontMono, colorInk)

	footer := fmt.Sprintf(`
<tr><td class="px" style="padding:24px 32px 8px 32px;">
  <p style="margin:0;font-family:%s;font-size:11px;line-height:16px;letter-spacing:1.3px;text-transform:uppercase;color:%s;">
    <span style="display:inline-block;width:6px;height:6px;background:%s;vertical-align:middle;margin:-2px 8px 0 0;"></span>Secure today. Enable tomorrow.
  </p>
  <p style="margin:14px 0 0 0;font-family:%s;font-size:13px;line-height:22px;color:%s;">
    <a href="%s/how-it-works" style="color:%s;text-decoration:none;">How it works</a>&nbsp;&nbsp;&nbsp;
    <a href="%s/knowledge-hub" style="color:%s;text-decoration:none;">Knowledge hub</a>&nbsp;&nbsp;&nbsp;
    <a href="%s/contact" style="color:%s;text-decoration:none;">Contact</a>&nbsp;&nbsp;&nbsp;
    <a href="mailto:info@aavishield.com" style="color:%s;text-decoration:none;">info@aavishield.com</a>
  </p>
</td></tr>
<tr><td class="px" style="padding:16px 32px 24px 32px;">
  <div style="height:1px;line-height:1px;font-size:0;background:%s;">&nbsp;</div>
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr>
    <td class="stack" style="font-family:%s;font-size:12px;line-height:18px;color:%s;">&copy; %d Aavishield, made by <span style="color:%s;">Aavish AI Lab</span>. All rights reserved.</td>
    <td class="stack" align="right" style="font-family:%s;font-size:12px;line-height:18px;color:%s;white-space:nowrap;">
      <a href="%s/privacy-policy" style="color:%s;text-decoration:none;">Privacy</a>&nbsp;&nbsp;
      <a href="%s/terms-and-conditions" style="color:%s;text-decoration:none;">Terms</a>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:0;border-top:1px solid %s;font-size:0;line-height:0;">
  <img src="%s" width="598" alt="" style="display:block;border:0;outline:none;width:100%%;max-width:598px;height:auto;">
</td></tr>`,
		fontMono, colorBrandInk, colorBrand,
		fontSans, colorMuted,
		html.EscapeString(site), colorFg2,
		html.EscapeString(site), colorFg2,
		html.EscapeString(site), colorFg2,
		colorFg2,
		siteRail,
		fontSans, colorMuted, time.Now().Year(), colorInk,
		fontSans, colorMuted,
		html.EscapeString(site), colorMuted,
		html.EscapeString(site), colorMuted,
		siteRail, html.EscapeString(assetURL("email-terrain-footer.png")))

	if reason != "" {
		footer = fmt.Sprintf(`
<tr><td class="px" style="padding:24px 32px 0 32px;font-family:%s;font-size:13px;line-height:20px;color:%s;">%s</td></tr>`,
			fontSans, colorMuted, reason) + strings.Replace(footer, "padding:24px 32px 8px 32px", "padding:16px 32px 8px 32px", 1)
	}

	var body strings.Builder
	body.WriteString(siteBand(header))
	for _, s := range sections {
		body.WriteString(siteDivider())
		body.WriteString(siteBand(s))
	}
	body.WriteString(siteDivider())
	body.WriteString(siteBand(footer))

	return fmt.Sprintf(`<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>%s</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500&display=swap" rel="stylesheet">
<style>
  body{margin:0!important;padding:0!important;width:100%%!important;-webkit-text-size-adjust:100%%;}
  @media only screen and (max-width:620px){
    .px{padding-left:24px!important;padding-right:24px!important;}
    .h1{font-size:32px!important;line-height:36px!important;letter-spacing:-1.2px!important;}
    .h2{font-size:28px!important;line-height:32px!important;}
    .stack{display:block!important;width:100%%!important;text-align:left!important;}
    .btnrow td.gap{display:none!important;}
    .btnrow td{display:inline-block!important;margin:0 8px 8px 0!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:%s;">
  <!--preheader--><div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:%s;">%s</div><!--/preheader-->
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" bgcolor="%s" style="background:%s;">
    <tr><td align="center" style="padding:20px 4px 28px 4px;">
      <!--[if mso]><table role="presentation" width="612" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="max-width:612px;">
        <!--marker-->%s
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body></html>`,
		html.EscapeString(title),
		siteBg, siteBg, html.EscapeString(preview),
		siteBg, siteBg,
		body.String(),
	)
}

// WelcomeOrg greets the first admin of a brand-new organization.
func WelcomeOrg(to, firstName, orgName string) {
	name := strings.TrimSpace(firstName)
	greeting := "Welcome aboard."
	if name != "" {
		greeting = "Welcome, " + name + "."
	}
	site := siteURL()
	org := html.EscapeString(orgName)

	// Hero: eyebrow, headline with an orange accent, intro and two buttons,
	// then the workspace card floating over the pixel terrain — the same
	// arrangement as the website hero with its "Live decisions" card.
	hero := fmt.Sprintf(`
<tr><td class="px" style="padding:40px 32px 32px 32px;">
  %s
  %s
  <p style="margin:20px 0 0 0;font-family:%s;font-size:17px;line-height:28px;color:%s;">
    <strong style="color:%s;font-weight:600;">%s</strong> is set up and your dashboard is live. Add your team,
    enrol their laptops and every device gets the same protection as the office, on any network.
  </p>
  <table role="presentation" class="btnrow" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;"><tr>
    %s
    <td class="gap" width="10" style="width:10px;">&nbsp;</td>
    %s
  </tr></table>
</td></tr>`,
		siteEyebrow("Welcome to Aavishield"),
		siteHeadline(greeting, "Your workspace is ready.", 46),
		fontSans, colorFg2, colorInk, org,
		siteButton("Open your dashboard", cfg.AppURL+"/dashboard", true),
		siteButton("How it works", site+"/how-it-works", false),
	)

	row := func(label, value, chip string) string {
		v := fmt.Sprintf(`<span style="font-family:%s;font-size:14px;line-height:20px;color:%s;">%s</span>`, fontSans, colorInk, html.EscapeString(value))
		if chip != "" {
			v = fmt.Sprintf(`<span style="display:inline-block;padding:2px 8px;border:1px solid #abefc6;background:#ecfdf3;border-radius:4px;
			  font-family:%s;font-size:10px;line-height:16px;letter-spacing:0.8px;text-transform:uppercase;color:%s;">&#9679; %s</span>`,
				fontMono, colorSuccess, html.EscapeString(chip))
		}
		return fmt.Sprintf(`<tr>
      <td style="padding:12px 16px;border-top:1px solid %s;font-family:%s;font-size:10px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:%s;width:38%%;">%s</td>
      <td align="right" style="padding:12px 16px;border-top:1px solid %s;">%s</td>
    </tr>`, colorLine, fontMono, colorMuted, html.EscapeString(label), colorLine, v)
	}
	card := fmt.Sprintf(`
<tr>%s
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"><tr><td class="px" style="padding:0 32px 152px 32px;">
    <p style="margin:0 0 -1px 18px;">
      <span style="display:inline-block;background:%s;padding:4px 8px;font-family:%s;font-size:10px;line-height:14px;letter-spacing:1px;
        text-transform:uppercase;color:#ffffff;">Aavishield agent</span>
    </p>
    <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"
           style="background:#ffffff;border:1px solid %s;border-radius:8px;box-shadow:0 24px 60px -24px rgba(24,24,27,0.22);">
      <tr>
        <td style="padding:12px 16px;font-family:%s;font-size:10px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:%s;">
          <span style="display:inline-block;width:6px;height:6px;background:%s;vertical-align:middle;margin:-2px 8px 0 0;"></span>Your workspace</td>
        <td align="right" style="padding:12px 16px;font-family:%s;font-size:10px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:%s;">Account</td>
      </tr>
      %s%s%s%s
    </table>
  </td></tr></table>
</td></tr>`,
		terrainCell("email-terrain-hero.png", "padding:0;"),
		colorBrand, fontMono,
		colorLine,
		fontMono, colorInk, colorBrand,
		fontMono, colorFaint,
		row("Organization", orgName, ""),
		row("Your role", "Administrator", ""),
		row("Sign in with", to, ""),
		row("Status", "", "Active"),
	)

	// Get started: numbered rows like the site's "01  BLOCK RISKY SITES".
	step := func(n, title, text, label, url string, last bool) string {
		border := "border-bottom:1px solid " + siteRail + ";"
		if last {
			border = ""
		}
		return fmt.Sprintf(`<tr><td style="padding:22px 0;%s">
      <p style="margin:0 0 10px 0;font-family:%s;font-size:11px;line-height:16px;letter-spacing:1.3px;text-transform:uppercase;color:%s;">
        <span style="color:%s;">%s</span>&nbsp;&nbsp;&nbsp;%s</p>
      <p style="margin:0;font-family:%s;font-size:15px;line-height:24px;color:%s;">%s</p>
      <p style="margin:12px 0 0 0;"><a href="%s" target="_blank" style="font-family:%s;font-size:11px;line-height:16px;letter-spacing:1.2px;
         text-transform:uppercase;color:%s;text-decoration:underline;text-underline-offset:4px;">%s</a></p>
    </td></tr>`, border, fontMono, colorInk, colorBrandInk, n, html.EscapeString(title),
			fontSans, colorFg2, text, html.EscapeString(url), fontMono, colorInk, html.EscapeString(label))
	}
	steps := fmt.Sprintf(`
<tr><td class="px" style="padding:40px 32px 24px 32px;">
  %s
  <h2 class="h2" style="margin:0;font-family:%s;font-size:34px;line-height:36px;font-weight:400;letter-spacing:-1.3px;color:%s;">Three steps to<br>full coverage</h2>
  <p style="margin:14px 0 0 0;font-family:%s;font-size:15px;line-height:24px;color:%s;">Most teams finish setup in under an hour. Start with a small pilot group, then roll out.</p>
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
    %s%s%s
  </table>
</td></tr>`,
		siteEyebrow("Get started"),
		fontDisplay, colorInk,
		fontSans, colorMuted,
		step("01", "Add your employees", "Add the people you want to protect, so every event is tied to a person, not just a device.",
			"Open employees", cfg.AppURL+"/dashboard/employees", false),
		step("02", "Enrol their devices", "Install the agent on macOS, Windows or Linux. Each laptop shows up in your dashboard as soon as it connects. No hardware or network changes.",
			"Open devices", cfg.AppURL+"/dashboard/devices", false),
		step("03", "Set your policies", "Decide what is allowed, flagged or blocked: websites, AI tools, apps, VPNs and sensitive data leaving the laptop.",
			"Open policies", cfg.AppURL+"/dashboard/swg", true),
	)

	// Closing band over the terrain, like the site's final call to action.
	closing := fmt.Sprintf(`
<tr>%s
  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"><tr><td class="px" style="padding:40px 32px 152px 32px;">
    <h2 class="h2" style="margin:0;font-family:%s;font-size:34px;line-height:36px;font-weight:400;letter-spacing:-1.4px;color:%s;">
      Security that travels with <span style="color:%s;">every laptop.</span></h2>
    <p style="margin:16px 0 24px 0;font-family:%s;font-size:15px;line-height:24px;color:%s;">
      Need a hand with setup? Write to <a href="mailto:info@aavishield.com" style="color:%s;">info@aavishield.com</a> or book a walkthrough with our team.</p>
    <table role="presentation" class="btnrow" cellpadding="0" cellspacing="0" border="0"><tr>%s</tr></table>
    <p style="margin:20px 0 0 0;font-family:%s;font-size:11px;line-height:16px;letter-spacing:1.1px;text-transform:uppercase;color:%s;">
      <span style="display:inline-block;width:6px;height:6px;background:%s;vertical-align:middle;margin:-2px 8px 0 0;"></span>Runs on macOS &middot; Windows &middot; Linux</p>
  </td></tr></table>
</td></tr>`,
		terrainCell("email-terrain-band.png", "padding:0;"),
		fontDisplay, colorInk, colorBrand,
		fontSans, colorFg2, colorBrandInk,
		siteButton("Book a walkthrough", site+"/contact", false),
		fontMono, colorMuted, colorBrand,
	)

	Send(Message{
		To:      []string{to},
		Subject: "Welcome to Aavishield — " + orgName + " is ready",
		HTML: sitePage("Welcome to Aavishield",
			orgName+" is set up and your dashboard is live. Here's how to get every laptop covered.",
			"You're receiving this because you just created an Aavishield workspace.",
			hero+card, steps, closing),
	})
}
