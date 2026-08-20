package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// TOTP (RFC 6238) implemented directly rather than pulled in as a dependency:
// it is thirty lines of HMAC, and an authentication primitive is worth being
// able to read and test in place.

const (
	totpDigits = 6
	// totpPeriod is the standard 30-second step every authenticator app uses.
	totpPeriod = 30
	// totpSkew accepts the neighbouring steps, so a clock a few seconds out —
	// or a user typing the last digit as the code rolls over — still works.
	totpSkew = 1
)

// GenerateTOTPSecret returns a new base32 secret in the form authenticator apps
// expect (no padding, uppercase).
func GenerateTOTPSecret() (string, error) {
	buf := make([]byte, 20) // 160 bits, the RFC 4226 recommendation
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return strings.TrimRight(base32.StdEncoding.EncodeToString(buf), "="), nil
}

// TOTPProvisioningURI builds the otpauth:// URI an app scans as a QR code.
func TOTPProvisioningURI(secret, accountEmail, issuer string) string {
	if issuer == "" {
		issuer = "Delsecure"
	}
	label := url.PathEscape(issuer + ":" + accountEmail)
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", fmt.Sprintf("%d", totpDigits))
	q.Set("period", fmt.Sprintf("%d", totpPeriod))
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// totpAt computes the code for a specific counter step.
func totpAt(secret string, counter uint64) (string, error) {
	// Authenticator apps show the secret in groups with spaces; users paste that.
	normalized := strings.ToUpper(strings.NewReplacer(" ", "", "-", "").Replace(secret))
	if pad := len(normalized) % 8; pad != 0 {
		normalized += strings.Repeat("=", 8-pad)
	}
	key, err := base32.StdEncoding.DecodeString(normalized)
	if err != nil {
		return "", fmt.Errorf("bad secret: %w", err)
	}

	msg := make([]byte, 8)
	binary.BigEndian.PutUint64(msg, counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(msg)
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	code := (uint32(sum[offset]&0x7f)<<24 |
		uint32(sum[offset+1])<<16 |
		uint32(sum[offset+2])<<8 |
		uint32(sum[offset+3])) % 1000000

	return fmt.Sprintf("%06d", code), nil
}

// VerifyTOTP checks a user-supplied code against the secret, allowing one step
// either side of now. Comparison is constant-time so a wrong code doesn't leak
// how much of it was right.
func VerifyTOTP(secret, code string) bool {
	code = strings.TrimSpace(strings.ReplaceAll(code, " ", ""))
	if len(code) != totpDigits {
		return false
	}

	counter := uint64(time.Now().Unix() / totpPeriod)
	for skew := -totpSkew; skew <= totpSkew; skew++ {
		candidate, err := totpAt(secret, counter+uint64(skew))
		if err != nil {
			return false
		}
		if subtle.ConstantTimeCompare([]byte(candidate), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

// GenerateRecoveryCodes returns human-transcribable one-time codes for the case
// an authenticator device is lost — without them, MFA turns a lost phone into a
// lost account.
func GenerateRecoveryCodes(count int) ([]string, error) {
	const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // no look-alikes
	codes := make([]string, 0, count)
	for i := 0; i < count; i++ {
		buf := make([]byte, 10)
		if _, err := rand.Read(buf); err != nil {
			return nil, err
		}
		var sb strings.Builder
		for j, b := range buf {
			if j == 5 {
				sb.WriteByte('-')
			}
			sb.WriteByte(alphabet[int(b)%len(alphabet)])
		}
		codes = append(codes, sb.String())
	}
	return codes, nil
}

// NormalizeRecoveryCode makes lookup forgiving of how the user typed it.
func NormalizeRecoveryCode(code string) string {
	return strings.ToUpper(strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(code)))
}

// HashRecoveryCode stores codes the same way passwords are: only the hash. A
// leaked database must not hand over a working second factor.
func HashRecoveryCode(code string) string {
	return HashRefreshToken(NormalizeRecoveryCode(code))
}
