package mailer

import "strings"

// Brand tokens, mirrored from frontend/website/src/app/globals.css. Email
// clients can't read CSS variables, so the values are repeated here and inlined
// into every element.
const (
	colorInk      = "#0b0b0d" // headings, primary button
	colorFg2      = "#3f3f46" // body copy
	colorMuted    = "#5d5d66" // secondary copy
	colorFaint    = "#8a8a93" // footer copy
	colorLine     = "#e7e7ea" // hairlines
	colorBg       = "#f1f1f2" // page behind the card
	colorSurface  = "#ffffff" // the card
	colorPanel    = "#fafafa" // stat tables, quotes
	colorBrand    = "#ff7000" // the one accent
	colorBrandInk = "#c2410c" // orange that passes contrast on white (links)
	colorSoft     = "#fff1e5"
	colorTint     = "#ffd9b8"
	colorDanger   = "#b42318"
	colorWarning  = "#b54708"
	colorSuccess  = "#067647"

	fontSans    = `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`
	fontDisplay = `'Satoshi','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`
	fontMono    = `'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`
)

// tone colours the category pill (and, for danger, the card's top edge).
type tone int

const (
	toneBrand tone = iota
	toneSuccess
	toneWarning
	toneDanger
)

func (t tone) colors() (text, bg, border string) {
	switch t {
	case toneSuccess:
		return colorSuccess, "#ecfdf3", "#abefc6"
	case toneWarning:
		return colorWarning, "#fffaeb", "#fedf89"
	case toneDanger:
		return colorDanger, "#fef3f2", "#fecdca"
	default:
		return colorBrandInk, colorSoft, colorTint
	}
}

// pattern is how the website's product patterns dress an email's content:
//
//   - patPlain: headline, body and button on the page background;
//   - patGrid: the details card sits on the orange pixel-grid stage, as
//     behind every product visual on the site (security, devices);
//   - patMark: the logo mark redrawn in orange pixels above the headline
//     (passwords, two-factor, codes).
//
// Separately, band picks which of the brand file's seven pixel-dither shapes
// closes the content (see the email-band-*.png assets), chosen by meaning as
// in Figma: terrain (the original), rise (growth, launch), sunrise
// (countdown, launch day), signal (coverage on any network), stream
// (monitoring, DLP, logs), wave (traffic, web gateway, VPN) and mesh
// (devices, fleet, every laptop). "" ends without a band.
type pattern int

const (
	patPlain pattern = iota
	patGrid
	patMark
)

// kind is the small uppercase label above the heading ("SECURITY ALERT",
// "BILLING") that tells the reader what sort of email this is at a glance,
// plus the pattern it wears, for patGrid the tag on the stage, and its band.
type kind struct {
	label string
	tone  tone
	pat   pattern
	stage string
	band  string
}

var (
	kWelcome     = kind{"Welcome", toneBrand, patPlain, "", ""}
	kTeamAccess  = kind{"Team access", toneBrand, patPlain, "", "mesh"}
	kAccount     = kind{"Account security", toneBrand, patMark, "", ""}
	kAccountWarn = kind{"Account security", toneWarning, patMark, "", ""}
	kPortal      = kind{"Employee portal", toneBrand, patPlain, "", "mesh"}
	kAccessReq   = kind{"Access request", toneWarning, patGrid, "Exception request", "wave"}
	kAlert       = kind{"Security alert", toneDanger, patGrid, "Incident", "stream"}
	kDigest      = kind{"Activity digest", toneWarning, patGrid, "Activity", "stream"}
	kCoverage    = kind{"Coverage check", toneWarning, patGrid, "Coverage", "signal"}
	kDevices     = kind{"Devices", toneBrand, patGrid, "Device", "mesh"}
	kDevicesOK   = kind{"Devices", toneSuccess, patGrid, "Device", "signal"}
	kDevicesWarn = kind{"Devices", toneWarning, patGrid, "Device", "signal"}
	kDevicesBad  = kind{"Devices", toneDanger, patGrid, "Device", "signal"}
	kWeekly      = kind{"Weekly summary", toneBrand, patGrid, "This week", "stream"}
	kMFA         = kind{"Two-factor", toneBrand, patMark, "", ""}
	kMFAOn       = kind{"Two-factor", toneSuccess, patMark, "", ""}
	kMFAOff      = kind{"Two-factor", toneDanger, patMark, "", ""}
	kSignIn      = kind{"Sign-in activity", toneWarning, patMark, "", ""}
	kCode        = kind{"Sign-in code", toneBrand, patMark, "", ""}
	kVerify      = kind{"Verify email", toneBrand, patMark, "", ""}
	kLead        = kind{"New lead", toneBrand, patPlain, "", "rise"}
	kDemo        = kind{"Demo", toneBrand, patPlain, "", "sunrise"}
	kDemoBooked  = kind{"Demo booked", toneSuccess, patPlain, "", "sunrise"}
	kDemoWarn    = kind{"Demo", toneWarning, patPlain, "", "sunrise"}
	kWaitlist    = kind{"Waitlist", toneBrand, patPlain, "", "rise"}
	kEarly       = kind{"Early access", toneBrand, patPlain, "", "sunrise"}
	kEarlyOpen   = kind{"Early access", toneSuccess, patPlain, "", "rise"}
	kResidency   = kind{"Data residency", toneDanger, patGrid, "Your storage", "stream"}
	kResidencyOK = kind{"Data residency", toneSuccess, patGrid, "Your storage", "stream"}
	kBilling     = kind{"Billing", toneBrand, patPlain, "", "terrain"}
	kBillingWarn = kind{"Billing", toneWarning, patPlain, "", "sunrise"}
	kBillingOK   = kind{"Billing", toneSuccess, patPlain, "", "rise"}
	kInvoice     = kind{"Invoice", toneBrand, patPlain, "", "terrain"}
	kPayment     = kind{"Payment", toneSuccess, patPlain, "", "rise"}
	kSupport     = kind{"Support", toneBrand, patPlain, "", "wave"}
	kSupportDone = kind{"Support", toneSuccess, patPlain, "", "wave"}
)

// siteURL is the marketing site linked from every footer.
func siteURL() string {
	return strings.TrimRight(envOr("MAIL_SITE_URL", "https://aavishield.com"), "/")
}
