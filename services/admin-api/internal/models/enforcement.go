package models

import (
	"github.com/aavishield/admin-api/internal/schedule"
	"github.com/google/uuid"
)

// Device ownership. This does not decide enforcement by itself — an absent
// schedule always means "always on" — but it is what lets the dashboard say
// "this is a personal laptop being monitored around the clock", which is the
// finding an audit would otherwise make for you.
const (
	OwnershipCompany  = "company"
	OwnershipPersonal = "personal"
)

// EnforcementSchedule is one organization's working-hours rule at one scope.
// Resolution is most-specific-wins: device > team > org > none (always on).
//
// Storing three scopes in one table rather than three columns on Device keeps
// the common case cheap — a company sets one org-wide schedule and every BYOD
// laptop inherits it — while still allowing the one contractor on a different
// shift to have their own.
type EnforcementSchedule struct {
	Base
	OrgID uuid.UUID `gorm:"type:uuid;not null;index" json:"org_id"`

	Scope    string     `gorm:"not null;index" json:"scope"` // org | team | device
	TeamID   *uuid.UUID `gorm:"type:uuid;index" json:"team_id"`
	DeviceID *uuid.UUID `gorm:"type:uuid;index" json:"device_id"`

	// IANA zone. The schedule's own timezone, never the device's — a laptop's
	// clock and timezone belong to the person being monitored.
	Timezone string `gorm:"default:'UTC'" json:"timezone"`

	Windows  []schedule.Window `gorm:"type:jsonb;serializer:json" json:"windows"`
	Holidays []string          `gorm:"type:jsonb;serializer:json" json:"holidays"`

	// full_pause | security_only — see the schedule package.
	OffHoursMode string `gorm:"default:'full_pause'" json:"off_hours_mode"`
	Enabled      bool   `gorm:"default:true" json:"enabled"`

	Note string `json:"note"`
}

// Spec flattens the row into what the evaluator needs.
func (s *EnforcementSchedule) Spec() *schedule.Spec {
	if s == nil {
		return nil
	}
	return &schedule.Spec{
		Timezone:     s.Timezone,
		Windows:      s.Windows,
		Holidays:     s.Holidays,
		OffHoursMode: s.OffHoursMode,
		Enabled:      s.Enabled,
		Source:       s.Scope,
	}
}
