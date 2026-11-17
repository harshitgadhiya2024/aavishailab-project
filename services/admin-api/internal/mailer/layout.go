package mailer

import (
	"fmt"
	"html"
	"strings"
)

// ink is the eyebrow colour for a tone: brand orange, or red / amber / green
// when the email is an alarm, a warning or good news.
func (t tone) ink() (text, mark string) {
	switch t {
	case toneSuccess:
		return colorSuccess, colorSuccess
	case toneWarning:
		return colorWarning, "#f79009"
	case toneDanger:
		return colorDanger, colorDanger
	default:
		return colorBrandInk, colorBrand
	}
}

// accentMark splits a heading into ink and orange parts: "Reset your ^password"
// renders "password" in brand orange, like the highlight words on the website.
const accentMark = "^"

// Spacing follows an 8px grid, with 32px side margins like the website's
// px-8 columns, so every block in every email lines up on the same edges.

func headline(heading string, t tone) string {
	plain, accent, _ := strings.Cut(heading, accentMark)
	accentColor := colorBrand
	if t == toneDanger {
		accentColor = colorDanger
	}
	acc := ""
	if accent != "" {
		acc = fmt.Sprintf(`<span style="color:%s;">%s</span>`, accentColor, html.EscapeString(accent))
	}
	// 40/44: Satoshi at -1.6px tracking, the site's tracking-[-0.04em].
	return fmt.Sprintf(`<h1 class="h1" style="margin:0;font-family:%s;font-size:40px;line-height:44px;font-weight:400;letter-spacing:-1.6px;color:%s;">%s%s</h1>`,
		fontDisplay, colorInk, html.EscapeString(plain), acc)
}

// eyebrow is the "■ LABEL" line above a headline, coloured by tone.
func eyebrow(k kind) string {
	text, mark := k.tone.ink()
	return fmt.Sprintf(`<p style="margin:0 0 16px 0;font-family:%s;font-size:11px;line-height:16px;letter-spacing:1.3px;text-transform:uppercase;color:%s;">
  <span style="display:inline-block;width:6px;height:6px;background:%s;vertical-align:middle;margin:-2px 8px 0 0;"></span>%s</p>`,
		fontMono, text, mark, html.EscapeString(k.label))
}

// Markers statTable puts around its card, so a patGrid email can lift the
// first card onto the pixel-grid stage. Other patterns just drop them.
const (
	stageOpen  = "<!--stage-->"
	stageClose = "<!--/stage-->"
)

// pixelStage is the website's product-visual stage: light orange with a 12px
// orange grid, "+" marks in the corners and an orange tag over the card.
func pixelStage(tag, inner string) string {
	u := html.EscapeString(assetURL("email-grid-tile.png"))
	plus := func(align string) string {
		return fmt.Sprintf(`<td align="%s" style="padding:6px 8px 0 8px;font-family:%s;font-size:13px;line-height:13px;color:#ffb27a;">+</td>`, align, fontMono)
	}
	plusBottom := func(align string) string {
		return fmt.Sprintf(`<td align="%s" style="padding:0 8px 6px 8px;font-family:%s;font-size:13px;line-height:13px;color:#ffb27a;">+</td>`, align, fontMono)
	}
	t := ""
	if tag != "" {
		t = fmt.Sprintf(`<p style="margin:0 0 -1px 16px;"><span style="display:inline-block;background:%s;padding:4px 8px;font-family:%s;
		  font-size:10px;line-height:14px;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">&#10148;&nbsp;%s</span></p>`,
			colorBrand, fontMono, html.EscapeString(tag))
	}
	return fmt.Sprintf(`<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px 0;"><tr>
  <td background="%s" bgcolor="%s" style="background-color:%s;background-image:url('%s');background-repeat:repeat;border:1px solid #ffe2cc;border-radius:4px;padding:0;">
    <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0">
      <tr>%s%s</tr>
      <tr><td colspan="2" style="padding:10px 22px 14px 22px;">%s%s</td></tr>
      <tr>%s%s</tr>
    </table>
  </td></tr></table>`, u, colorSoft, colorSoft, u, plus("left"), plus("right"), t, inner, plusBottom("left"), plusBottom("right"))
}

// layout renders a transactional email in the website style shared with the
// welcome email (see sitePage): the logo bar, then the eyebrow, a light
// Satoshi headline with an optional orange accent (see accentMark), the
// intro, the body and an orange call to action, then the footer. The email
// family's kind decides how the brand patterns dress it: the pixel mark above
// the headline or the pixel-grid stage under the details card (see pattern),
// and the pixel-dither band the section ends on (see kind.band).
//
// heading is plain text and escaped here; intro, body and footer are trusted
// HTML that callers have already escaped. footer is the "why you got this"
// line; "" uses a generic one.
func layout(k kind, heading, intro, body, ctaLabel, ctaURL, footer string) string {
	if footer == "" {
		footer = "You're receiving this because you use Aavishield to protect your organization."
	}

	introRow := ""
	if intro != "" {
		introRow = fmt.Sprintf(`<p style="margin:16px 0 0 0;font-family:%s;font-size:17px;line-height:28px;color:%s;">%s</p>`,
			fontSans, colorFg2, intro)
	}
	text := eyebrow(k) + headline(heading, k.tone) + introRow

	var top string
	switch k.pat {
	case patMark:
		// The logo mark in pixels (cmd/email-assets/mark.go), shown at its
		// exact 1x size so every pixel lands on the grid. Its first column
		// sits on the text edge.
		top = fmt.Sprintf(`
<tr><td class="px" style="padding:40px 32px 0 32px;">
  <img src="%s" width="168" height="96" alt="" style="display:block;border:0;outline:none;width:168px;height:96px;margin:0 0 32px 0;">
  %s
</td></tr>`, html.EscapeString(assetURL("email-pixel-mark.png")), text)
	default:
		top = fmt.Sprintf(`
<tr><td class="px" style="padding:40px 32px 0 32px;">%s</td></tr>`, text)
	}

	// patGrid lifts the details card onto the pixel-grid stage; when the body
	// has no card, its text goes into one so the stage still has a subject.
	if k.pat == patGrid && body != "" {
		if i := strings.Index(body, stageOpen); i >= 0 {
			j := strings.Index(body[i:], stageClose)
			if j > 0 {
				body = body[:i] + pixelStage(k.stage, body[i+len(stageOpen):i+j]) + body[i+j+len(stageClose):]
			}
		} else {
			body = pixelStage(k.stage, card("", fmt.Sprintf(`<tr><td style="padding:18px 20px;font-family:%s;font-size:15px;line-height:24px;color:%s;">%s</td></tr>`,
				fontSans, colorFg2, body)))
		}
	}
	body = strings.NewReplacer(stageOpen, "", stageClose, "").Replace(body)

	bodyRow := ""
	if body != "" {
		bodyRow = fmt.Sprintf(`
<tr><td class="px" style="padding:24px 32px 0 32px;font-family:%s;font-size:15px;line-height:24px;color:%s;">%s</td></tr>`,
			fontSans, colorFg2, body)
	}

	cta := ""
	if ctaLabel != "" && ctaURL != "" {
		cta = fmt.Sprintf(`
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>%s</tr></table>
    <p style="margin:16px 0 0 0;font-family:%s;font-size:12px;line-height:18px;color:%s;max-width:336px;">
      Or paste this link into your browser:<br>
      <a href="%s" style="color:%s;text-decoration:underline;word-break:break-all;">%s</a></p>`,
			siteButton(ctaLabel, ctaURL, true),
			fontSans, colorMuted, html.EscapeString(ctaURL), colorMuted, html.EscapeString(ctaURL))
	}
	// The section closes on its band: one of the brand file's pixel-dither
	// shapes, sitting on the hairline below exactly as the Figma bands do.
	// It is an <img>, not a background, so it scales on phones and shows in
	// Outlook too.
	var close string
	switch {
	case k.band != "" && cta != "":
		close = fmt.Sprintf(`
<tr><td class="px" style="padding:32px 32px 8px 32px;">%s</td></tr>%s`, cta, band(k.band))
	case k.band != "":
		close = `
<tr><td style="padding:16px 0 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>` + band(k.band)
	default:
		close = fmt.Sprintf(`
<tr><td class="px" style="padding:32px 32px 40px 32px;">%s</td></tr>`, cta)
	}

	title := strings.ReplaceAll(heading, accentMark, "")
	return sitePage(title, preheaderText(intro, title), footer, top+bodyRow+close)
}

// band renders one of the brand file's pixel-dither bands across the full
// width of the framed column: 598×183, from the Figma SVGs in
// docs/brand/patterns rasterised at exactly 2x by cmd/email-assets.
func band(shape string) string {
	return fmt.Sprintf(`
<tr><td style="padding:0;font-size:0;line-height:0;">
  <img src="%s" width="598" height="183" alt="" style="display:block;border:0;outline:none;width:100%%;max-width:598px;height:auto;">
</td></tr>`, html.EscapeString(assetURL("email-band-"+shape+".png")))
}

// preheaderText is the grey preview line inbox lists show after the subject.
// Without it, clients show whatever text comes first — usually the logo's alt.
func preheaderText(intro, heading string) string {
	s := strings.TrimSpace(stripHTML(intro)) // stripHTML also unescapes entities
	if s == "" {
		s = heading
	}
	return s
}

// statRow renders one "label / value" line of a statTable. color tints the
// value, e.g. red for blocked counts; "" is ink.
func statRow(label, value, color string) string {
	if color == "" {
		color = colorInk
	}
	return fmt.Sprintf(`<tr>
      <td valign="top" style="padding:12px 16px;border-top:1px solid %s;font-family:%s;font-size:10px;line-height:20px;
          letter-spacing:1px;text-transform:uppercase;color:%s;width:40%%;">%s</td>
      <td valign="top" align="right" style="padding:12px 16px;border-top:1px solid %s;font-family:%s;font-size:14px;line-height:20px;
          color:%s;text-align:right;word-break:break-word;">%s</td>
    </tr>`, colorLine, fontMono, colorMuted, html.EscapeString(label),
		colorLine, fontSans, color, html.EscapeString(value))
}

// card is the white product-visual card from the website (like its "Live
// decisions" panel), optionally with an orange tag sitting on its top edge.
func card(tag, inner string) string {
	t := ""
	if tag != "" {
		t = fmt.Sprintf(`<p style="margin:0 0 -1px 16px;"><span style="display:inline-block;background:%s;padding:4px 8px;font-family:%s;
		  font-size:10px;line-height:14px;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">%s</span></p>`,
			colorBrand, fontMono, html.EscapeString(tag))
	}
	return fmt.Sprintf(`%s<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"
       style="background:#ffffff;border:1px solid %s;border-radius:8px;box-shadow:0 24px 60px -24px rgba(24,24,27,0.22);margin:6px 0 4px 0;">%s</table>`,
		t, colorLine, inner)
}

// statTable groups statRows in a card, with hairlines between rows only.
func statTable(rows ...string) string {
	if len(rows) > 0 {
		rows = append([]string(nil), rows...)
		rows[0] = strings.ReplaceAll(rows[0], "border-top:1px solid "+colorLine, "border-top:0")
	}
	return stageOpen + card("", strings.Join(rows, "")) + stageClose
}

// secretBox shows a temporary password or similar value the reader must copy.
func secretBox(label, value string) string {
	return `<div style="height:22px;line-height:22px;font-size:0;">&nbsp;</div>` + card(label, fmt.Sprintf(
		`<tr><td style="padding:16px 18px;font-family:%s;font-size:17px;line-height:24px;letter-spacing:1px;color:%s;">%s</td></tr>`,
		fontMono, colorInk, html.EscapeString(value)))
}

// codeBlock renders a one-time code large enough to read off a phone at a glance.
func codeBlock(code string) string {
	return `<div style="height:6px;line-height:6px;font-size:0;">&nbsp;</div>` + card("One-time code", fmt.Sprintf(
		`<tr><td align="center" style="padding:26px 16px;"><span style="font-family:%s;font-size:38px;line-height:44px;letter-spacing:12px;font-weight:500;color:%s;">%s</span></td></tr>`,
		fontMono, colorInk, html.EscapeString(code))) + `<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>`
}

// sectionTitle is a small "■ LABEL" introducing a list or block in the body.
func sectionTitle(s string) string {
	return fmt.Sprintf(`<p style="margin:28px 0 10px 0;font-family:%s;font-size:11px;line-height:16px;letter-spacing:1.3px;text-transform:uppercase;color:%s;">
  <span style="display:inline-block;width:6px;height:6px;background:%s;vertical-align:middle;margin:-2px 8px 0 0;"></span>%s</p>`,
		fontMono, colorInk, colorBrand, html.EscapeString(s))
}

// bulletList renders items as a brand-styled list (orange square markers).
// Items are trusted HTML.
func bulletList(items ...string) string {
	var b strings.Builder
	b.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 0 0;">`)
	for _, it := range items {
		fmt.Fprintf(&b, `<tr><td valign="top" width="20" style="padding:9px 0 0 0;"><div style="width:6px;height:6px;background:%s;font-size:0;line-height:0;">&nbsp;</div></td>
	<td style="padding:2px 0 6px 0;font-family:%s;font-size:15px;line-height:24px;color:%s;">%s</td></tr>`, colorBrand, fontSans, colorFg2, it)
	}
	b.WriteString(`</table>`)
	return b.String()
}

// stepList renders numbered instructions like the website's "01  BLOCK RISKY
// SITES" rows: an orange mono number, hairlines between steps. Items are
// trusted HTML.
func stepList(items ...string) string {
	var b strings.Builder
	b.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 6px 0;">`)
	for i, it := range items {
		border := "border-bottom:1px solid " + siteRail + ";"
		if i == len(items)-1 {
			border = ""
		}
		fmt.Fprintf(&b, `<tr><td valign="top" width="40" style="padding:14px 0;%sfont-family:%s;font-size:12px;line-height:24px;letter-spacing:1px;color:%s;">%02d</td>
	<td valign="top" style="padding:14px 0;%sfont-family:%s;font-size:15px;line-height:24px;color:%s;">%s</td></tr>`,
			border, fontMono, colorBrandInk, i+1, border, fontSans, colorFg2, it)
	}
	b.WriteString(`</table>`)
	return b.String()
}

// escapeAll HTML-escapes each string, for passing plain text to bulletList.
func escapeAll(items []string) []string {
	out := make([]string, len(items))
	for i, s := range items {
		out[i] = html.EscapeString(s)
	}
	return out
}

// message is one person's words shown in an email: a support request or
// reply, or the note on a demo request.
type message struct {
	author      string // who wrote it, e.g. "Ayumi Tanabe"
	role        string // a short line under the name, e.g. "Customer · Corvane Logistics"
	team        bool   // written by Aavishield: a solid orange avatar instead of a soft one
	ref         string // shown top right, e.g. "DS-1042"; "" for none
	body        string // plain text; line breaks are kept
	attachments int
}

// messageCard renders a message as the website's product card: an initial
// avatar, the author and their role, the reference on the right, a hairline,
// then the text, with any attachments noted in a footer inside the card.
func messageCard(m message) string {
	initial := "?"
	if r := []rune(strings.TrimSpace(m.author)); len(r) > 0 {
		initial = strings.ToUpper(string(r[0]))
	}
	avBg, avBorder, avFg := colorSoft, colorTint, colorBrandInk
	if m.team {
		avBg, avBorder, avFg = colorBrand, colorBrand, "#ffffff"
	}
	ref := ""
	if m.ref != "" {
		ref = fmt.Sprintf(`<td align="right" valign="top" style="padding:2px 0 0 12px;font-family:%s;font-size:10px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:%s;white-space:nowrap;">%s</td>`,
			fontMono, colorFaint, html.EscapeString(m.ref))
	}
	role := ""
	if m.role != "" {
		role = fmt.Sprintf(`<div style="font-family:%s;font-size:10px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:%s;">%s</div>`,
			fontMono, colorMuted, html.EscapeString(m.role))
	}
	footer := ""
	if m.attachments > 0 {
		s := "s"
		if m.attachments == 1 {
			s = ""
		}
		footer = fmt.Sprintf(`
  <tr><td style="padding:0 16px;"><div style="height:1px;line-height:1px;font-size:0;background:%s;">&nbsp;</div></td></tr>
  <tr><td style="padding:12px 16px 14px 16px;font-family:%s;font-size:10px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:%s;">
    <span style="display:inline-block;width:6px;height:6px;background:%s;vertical-align:middle;margin:-2px 8px 0 0;"></span>%d attachment%s &middot; open the request to view</td></tr>`,
			colorLine, fontMono, colorMuted, colorBrand, m.attachments, s)
	}
	return fmt.Sprintf(`<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"
       style="background:#ffffff;border:1px solid %s;border-radius:8px;box-shadow:0 24px 60px -24px rgba(24,24,27,0.22);margin:16px 0 0 0;">
  <tr><td style="padding:16px 16px 14px 16px;">
    <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="top" width="32" style="width:32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" valign="middle" width="30" height="30" bgcolor="%s" style="width:30px;height:30px;background:%s;border:1px solid %s;border-radius:6px;
              font-family:%s;font-size:13px;line-height:30px;font-weight:500;color:%s;">%s</td>
        </tr></table>
      </td>
      <td valign="top" style="padding:0 0 0 12px;">
        <div style="font-family:%s;font-size:14px;line-height:16px;font-weight:600;color:%s;padding:0 0 2px 0;">%s</div>
        %s
      </td>
      %s
    </tr></table>
  </td></tr>
  <tr><td style="padding:0 16px;"><div style="height:1px;line-height:1px;font-size:0;background:%s;">&nbsp;</div></td></tr>
  <tr><td style="padding:16px 16px 18px 16px;font-family:%s;font-size:15px;line-height:24px;color:%s;white-space:pre-wrap;">%s</td></tr>%s
</table>`,
		colorLine,
		avBg, avBg, avBorder, fontMono, avFg, html.EscapeString(initial),
		fontSans, colorInk, html.EscapeString(m.author),
		role, ref,
		colorLine,
		fontSans, colorInk, html.EscapeString(strings.TrimSpace(m.body)),
		footer)
}
