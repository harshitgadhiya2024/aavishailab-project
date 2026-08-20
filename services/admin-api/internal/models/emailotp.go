package models

import (
	"time"

	"github.com/google/uuid"
)

// OTPPurpose distinguishes the two flows a one-time code can belong to. A code
// minted to finish a sign-in must never be redeemable to create an account,
// so the purpose is checked on every verification.
type OTPPurpose string

const (
	OTPPurposeLogin    OTPPurpose = "login"
	OTPPurposeRegister OTPPurpose = "register"
)

// EmailOTP is a one-time code sent to an email address.
//
// Only the hash is stored — the same reasoning as passwords and recovery codes:
// a leaked database must not contain anything that can be typed into a login
// box. Attempts are counted so a 6-digit code can't be brute-forced, and the
// pending registration payload lives here so no organization is created until
// its email address has actually been proven.
type EmailOTP struct {
	ID        uuid.UUID      `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	Email     string         `gorm:"not null;index" json:"email"`
	CodeHash  string         `gorm:"not null;index" json:"-"`
	Purpose   OTPPurpose     `gorm:"type:varchar(20);not null;index" json:"purpose"`
	UserID    *uuid.UUID     `gorm:"type:uuid;index" json:"user_id"`
	Payload   map[string]any `gorm:"type:jsonb;serializer:json" json:"-"`
	Attempts  int            `gorm:"default:0" json:"attempts"`
	ExpiresAt time.Time      `json:"expires_at"`
	ConsumedAt *time.Time    `json:"consumed_at"`
	IPAddress string         `json:"ip_address"`
	CreatedAt time.Time      `json:"created_at"`
}

// MaxOTPAttempts is how many wrong guesses a single code tolerates before it is
// burned. Six digits is only a million combinations, so this matters.
const MaxOTPAttempts = 5

// OTPValidity is how long a code works for.
const OTPValidity = 10 * time.Minute
