package models

import (
	"time"

	"github.com/google/uuid"
)

// ─── Prelaunch waitlist ──────────────────────────────────────────────────────
// A sign-up from the prelaunch page on the marketing website (/waitlist). The
// website posts it server-to-server (see handlers.WaitlistHandler.Submit);
// the superadmin panel is where the team works through the list and invites
// people in.

type WaitlistStatus string

const (
	WaitlistWaiting   WaitlistStatus = "waiting"
	WaitlistInvited   WaitlistStatus = "invited"
	WaitlistOnboarded WaitlistStatus = "onboarded"
	WaitlistDeclined  WaitlistStatus = "declined"
)

type WaitlistEntry struct {
	Base
	Name    string `gorm:"not null" json:"name"`
	// One entry per address: a repeat sign-up is answered as a success but
	// not stored twice (checked in the handler, so soft-deleted rows don't
	// block someone from joining again).
	Email    string `gorm:"not null;index" json:"email"`
	Company  string `gorm:"not null" json:"company"`
	TeamSize string `json:"team_size"`
	Role     string `json:"role"`
	// Page path plus any utm_* parameters the visitor arrived with.
	Source    string         `json:"source"`
	IPAddress string         `json:"ip_address"`
	UserAgent string         `json:"user_agent"`
	Status    WaitlistStatus `gorm:"type:varchar(20);default:'waiting';index" json:"status"`
	Notes     string         `gorm:"type:text" json:"notes"`
	// Set the first time the entry is moved to "invited".
	InvitedAt *time.Time `json:"invited_at"`
	// Set by whichever superadmin last changed the status or notes.
	UpdatedBy *uuid.UUID `gorm:"type:uuid" json:"updated_by"`
}
