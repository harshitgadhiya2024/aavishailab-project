package handlers

import "strings"

// Self-serve sign-up is for companies, so it asks for a work address. A
// monitoring product open to personal mailboxes invites exactly the misuse
// (watching a partner's laptop) the trial limits exist to prevent.
var personalEmailDomains = map[string]bool{
	"gmail.com": true, "googlemail.com": true, "yahoo.com": true, "yahoo.co.in": true, "yahoo.in": true,
	"ymail.com": true, "rocketmail.com": true, "outlook.com": true, "hotmail.com": true, "hotmail.co.in": true,
	"live.com": true, "live.in": true, "msn.com": true, "icloud.com": true, "me.com": true, "mac.com": true,
	"aol.com": true, "proton.me": true, "protonmail.com": true, "pm.me": true, "zoho.com": true, "zohomail.com": true,
	"zohomail.in": true, "gmx.com": true, "gmx.net": true, "mail.com": true, "yandex.com": true, "yandex.ru": true,
	"rediffmail.com": true, "tutanota.com": true, "tuta.io": true, "fastmail.com": true, "hey.com": true,
	"qq.com": true, "163.com": true, "126.com": true,
	// Disposable inboxes.
	"mailinator.com": true, "guerrillamail.com": true, "10minutemail.com": true, "tempmail.com": true,
	"temp-mail.org": true, "yopmail.com": true, "trashmail.com": true, "sharklasers.com": true,
	"getnada.com": true, "dispostable.com": true, "maildrop.cc": true, "throwawaymail.com": true,
}

// isPersonalEmail reports whether an address is on a personal or disposable domain.
func isPersonalEmail(email string) bool {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return false
	}
	return personalEmailDomains[strings.ToLower(strings.TrimSpace(email[at+1:]))]
}
