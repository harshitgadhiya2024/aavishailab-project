package auth

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
)

// OTPLength is six digits — long enough that guessing is impractical inside the
// attempt limit, short enough to read out of an email and type on a phone.
const OTPLength = 6

// GenerateOTPCode returns a cryptographically random numeric code. math/rand
// would be predictable from a known seed, which for an authentication code is
// the whole ballgame.
func GenerateOTPCode() (string, error) {
	max := big.NewInt(1)
	for i := 0; i < OTPLength; i++ {
		max.Mul(max, big.NewInt(10))
	}
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", OTPLength, n), nil
}

// NormalizeOTP strips the spaces and dashes people paste out of emails.
func NormalizeOTP(code string) string {
	return strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(code))
}

// HashOTP stores codes the same way every other secret here is stored.
func HashOTP(code string) string {
	return HashRefreshToken(NormalizeOTP(code))
}
