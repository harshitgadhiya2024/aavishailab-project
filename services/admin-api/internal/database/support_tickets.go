package database

import "gorm.io/gorm"

// MigrateSupportTickets gives every ticket a human reference number from a
// sequence (DS-1001, DS-1002...) and backfills the conversation fields added
// after the first tickets existed. Every statement is idempotent.
func MigrateSupportTickets(db *gorm.DB) error {
	stmts := []string{
		`CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START WITH 1001`,
		`ALTER TABLE support_tickets ALTER COLUMN number SET DEFAULT nextval('support_ticket_number_seq')`,
		`UPDATE support_tickets SET number = nextval('support_ticket_number_seq') WHERE number IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_support_tickets_number ON support_tickets(number)`,
		// Messages written by a superadmin before sides existed were support replies.
		`UPDATE support_ticket_messages m SET side = 'support'
			FROM users u WHERE u.id = m.author_id AND u.role = 'superadmin' AND m.side = 'customer'`,
		`UPDATE support_tickets t SET
			last_message_at = x.at, last_message_side = x.side
			FROM (SELECT DISTINCT ON (ticket_id) ticket_id, created_at AS at, side
			      FROM support_ticket_messages WHERE side <> 'system' AND internal = false
			      ORDER BY ticket_id, created_at DESC) x
			WHERE x.ticket_id = t.id AND t.last_message_at IS NULL`,
	}
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			return err
		}
	}
	return nil
}
