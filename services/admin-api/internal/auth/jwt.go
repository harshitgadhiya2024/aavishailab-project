package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("token expired")
)

type Claims struct {
	UserID     uuid.UUID       `json:"user_id"`
	OrgID      *uuid.UUID      `json:"org_id"`
	EmployeeID *uuid.UUID      `json:"employee_id,omitempty"` // non-nil for portal employee tokens
	Email      string          `json:"email"`
	Role       models.UserRole `json:"role"`
	TokenID    string          `json:"jti"`
	jwt.RegisteredClaims
}

// GeneratePortalToken creates a JWT for an employee using the Employee Portal.
func GeneratePortalToken(emp *models.Employee) (string, *Claims, error) {
	now := time.Now()
	empID := emp.ID
	orgID := emp.OrgID
	claims := &Claims{
		UserID:     emp.ID,
		OrgID:      &orgID,
		EmployeeID: &empID,
		Email:      emp.Email,
		Role:       "employee",
		TokenID:    uuid.New().String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   emp.ID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(8 * time.Hour)),
			Issuer:    "aavishield-portal",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(accessSecret())
	return signed, claims, err
}

func accessSecret() []byte {
	s := os.Getenv("JWT_ACCESS_SECRET")
	if s == "" {
		s = "aavishield-access-secret-change-in-production"
	}
	return []byte(s)
}

func refreshSecret() []byte {
	s := os.Getenv("JWT_REFRESH_SECRET")
	if s == "" {
		s = "aavishield-refresh-secret-change-in-production"
	}
	return []byte(s)
}

func accessExpiry() time.Duration {
	return 15 * time.Minute
}

func refreshExpiry() time.Duration {
	return 7 * 24 * time.Hour
}

// GenerateAccessToken creates a short-lived JWT access token
func GenerateAccessToken(user *models.User) (string, *Claims, error) {
	now := time.Now()
	claims := &Claims{
		UserID:  user.ID,
		OrgID:   user.OrgID,
		Email:   user.Email,
		Role:    user.Role,
		TokenID: uuid.New().String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(accessExpiry())),
			Issuer:    "aavishield",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(accessSecret())
	return signed, claims, err
}

// GenerateRefreshToken creates a long-lived opaque refresh token
func GenerateRefreshToken() (plain string, hashed string, err error) {
	id := uuid.New().String() + uuid.New().String()
	h := sha256.Sum256([]byte(id))
	return id, hex.EncodeToString(h[:]), nil
}

// HashRefreshToken hashes an incoming refresh token for DB lookup
func HashRefreshToken(plain string) string {
	h := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(h[:])
}

// ParseAccessToken validates and parses a JWT access token
func ParseAccessToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return accessSecret(), nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// RefreshExpiry returns expiry time for refresh tokens
func RefreshExpiry() time.Time {
	return time.Now().Add(refreshExpiry())
}

// ─── MFA challenge ────────────────────────────────────────────────────────────

// mfaChallengeClaims is deliberately not a Claims: it must not be accepted
// anywhere an access token is expected. It says only "this person passed the
// password step for this user id, moments ago".
type mfaChallengeClaims struct {
	UserID  uuid.UUID `json:"user_id"`
	Purpose string    `json:"purpose"`
	jwt.RegisteredClaims
}

const mfaChallengePurpose = "mfa_challenge"

// mfaChallengeTTL is how long the gap between password and code may be. Long
// enough to open an authenticator app for the first time, short enough that a
// stolen challenge is worthless — and the client re-issues it transparently if
// it does lapse.
const mfaChallengeTTL = 10 * time.Minute

// GenerateMFAChallenge issues the short-lived token that carries a login
// between the password step and the second factor.
func GenerateMFAChallenge(user *models.User) (string, error) {
	now := time.Now()
	claims := &mfaChallengeClaims{
		UserID:  user.ID,
		Purpose: mfaChallengePurpose,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(mfaChallengeTTL)),
			Issuer:    "aavishield-mfa",
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(accessSecret())
}

// ParseMFAChallenge validates a challenge token and returns whose login it is.
func ParseMFAChallenge(tokenStr string) (uuid.UUID, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &mfaChallengeClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return accessSecret(), nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return uuid.Nil, ErrExpiredToken
		}
		return uuid.Nil, ErrInvalidToken
	}
	claims, ok := token.Claims.(*mfaChallengeClaims)
	if !ok || !token.Valid || claims.Purpose != mfaChallengePurpose {
		return uuid.Nil, ErrInvalidToken
	}
	return claims.UserID, nil
}
