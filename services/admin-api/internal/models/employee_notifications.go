package models

import (
	"time"

	"github.com/google/uuid"
)

// EmployeeNotification is one item in an employee's portal bell: things that
// happened to *them* in the control plane — a decision on their access
// request, a device joining or being revoked, their password changing.
//
// Activity (blocked/alerted events) is deliberately not copied in here: it
// lives in the company's data plane, possibly their own database, and the
// bell reads it from there on demand.
type EmployeeNotification struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	OrgID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"-"`
	EmployeeID uuid.UUID  `gorm:"type:uuid;not null;index:idx_emp_notif_feed,priority:1" json:"-"`
	Kind       string     `gorm:"type:varchar(40);not null" json:"kind"`
	Title      string     `gorm:"not null" json:"title"`
	Body       string     `json:"body"`
	Link       string     `json:"link"`
	ReadAt     *time.Time `json:"read_at"`
	CreatedAt  time.Time  `gorm:"index:idx_emp_notif_feed,priority:2,sort:desc" json:"created_at"`
}

// EmployeeNotificationState holds the employee's "seen up to" mark, which is
// what makes data-plane activity items read or unread without storing them.
type EmployeeNotificationState struct {
	EmployeeID uuid.UUID `gorm:"type:uuid;primaryKey" json:"-"`
	SeenAt     time.Time `json:"seen_at"`
}
