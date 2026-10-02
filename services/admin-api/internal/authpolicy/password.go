// Package authpolicy holds the account-security rules shared by the dashboard
// and the employee portal: how strong a password must be, and how many failed
// sign-ins an account tolerates before it is briefly locked.
package authpolicy

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode"
)

// MinPasswordLength is the floor for any new or changed password. Ten with a
// mix of character classes, or a longer passphrase, keeps out the short,
// guessable passwords the old eight-character minimum allowed.
const MinPasswordLength = 10

// commonPasswords is a small bundled deny-list of the passwords attackers try
// first. It is not exhaustive — the length and character-class rules do most
// of the work — but it rejects the handful that technically pass those rules
// (e.g. "Password@1", "Admin@1234").
var commonPasswords = map[string]bool{
	"password": true, "password1": true, "password@1": true, "password123": true,
	"admin@123": true, "admin@1234": true, "admin1234": true, "administrator": true,
	"welcome@1": true, "welcome123": true, "qwerty@123": true, "changeme": true,
	"letmein": true, "iloveyou": true, "aavishield": true, "aavishield@1": true,
	"superadmin@123": true, "employee@123": true, "test@1234": true, "passw0rd": true,
}

// ValidatePassword returns a human-readable reason the password is unacceptable,
// or "" when it is fine. email (optional) is rejected as a substring so a
// password can't just echo the account name.
//
// Set PASSWORD_HIBP_CHECK=true to also reject passwords found in the Have I
// Been Pwned breach corpus (k-anonymity API — only the first five SHA-1 hex
// chars leave the server). That check fails open: if the API can't be reached
// it does not block a signup, since availability of a third party must not
// gate account creation.
func ValidatePassword(pw, email string) string {
	if len([]rune(pw)) < MinPasswordLength {
		return fmt.Sprintf("Use at least %d characters.", MinPasswordLength)
	}
	if len(pw) > 200 {
		return "That password is too long."
	}
	var lower, upper, digit, symbol bool
	for _, r := range pw {
		switch {
		case unicode.IsLower(r):
			lower = true
		case unicode.IsUpper(r):
			upper = true
		case unicode.IsDigit(r):
			digit = true
		default:
			symbol = true
		}
	}
	classes := 0
	for _, ok := range []bool{lower, upper, digit, symbol} {
		if ok {
			classes++
		}
	}
	// A short-ish password must mix classes; a long passphrase need not.
	if classes < 3 && len([]rune(pw)) < 14 {
		return "Mix upper- and lower-case letters, a number and a symbol (or use a longer passphrase)."
	}
	norm := strings.ToLower(strings.TrimSpace(pw))
	if commonPasswords[norm] {
		return "That password is too common. Choose something harder to guess."
	}
	if local := emailLocalPart(email); local != "" && len(local) >= 3 && strings.Contains(norm, local) {
		return "Your password should not contain your email address."
	}
	if hibpEnabled() && pwnedCount(pw) > 0 {
		return "That password has appeared in a known data breach. Choose a different one."
	}
	return ""
}

func emailLocalPart(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	if i := strings.IndexByte(email, '@'); i > 0 {
		return email[:i]
	}
	return ""
}

func hibpEnabled() bool { return os.Getenv("PASSWORD_HIBP_CHECK") == "true" }

// pwnedCount asks the HIBP range API how many times a password appears in
// breaches. Returns 0 on any error (fail open).
func pwnedCount(pw string) int {
	sum := sha1.Sum([]byte(pw))
	hash := strings.ToUpper(hex.EncodeToString(sum[:]))
	prefix, suffix := hash[:5], hash[5:]

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.pwnedpasswords.com/range/"+prefix, nil)
	if err != nil {
		return 0
	}
	req.Header.Set("Add-Padding", "true")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0
	}
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, suffix) {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				var n int
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &n)
				return n
			}
		}
	}
	return 0
}
