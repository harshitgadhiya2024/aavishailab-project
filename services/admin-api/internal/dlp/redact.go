package dlp

// redactDigits keeps only the last 4 digits visible (card/Aadhaar-style
// redaction) — never store/log the full identifier, only enough to be a
// useful audit-trail preview.
func redactDigits(digits string) string {
	if len(digits) <= 4 {
		return "****"
	}
	masked := make([]byte, len(digits)-4)
	for i := range masked {
		masked[i] = '*'
	}
	return string(masked) + digits[len(digits)-4:]
}

// redactAlnum keeps a short prefix (enough to identify the credential type,
// e.g. "AKIA****" or "ghp_****") without exposing the secret itself.
func redactAlnum(s string) string {
	const keep = 4
	if len(s) <= keep {
		return "****"
	}
	return s[:keep] + "****"
}
