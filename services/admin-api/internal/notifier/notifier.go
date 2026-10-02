// Package notifier decides when to send the emails nobody explicitly triggered:
// "incidents are piling up", "you've gone quiet", and the weekly summary.
//
// Every rule here is rate-limited through the organization's settings, because
// the failure mode of automated email isn't missing a message — it's sending so
// many that admins filter the whole product to spam.
package notifier

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
)

const (
	// digestThreshold is how many unreviewed incidents must accumulate before
	// an org is emailed about them.
	digestThreshold = 10
	// digestCooldown stops a busy org getting a digest every hour.
	digestCooldown = 6 * time.Hour
	// inactivityDays is how long silence must last before it's worth flagging.
	inactivityDays = 3
	// inactivityCooldown — one nudge every few days, not every tick.
	inactivityCooldown = 3 * 24 * time.Hour
	// weeklyCooldown keeps the routine summary to roughly one a week.
	weeklyCooldown = 7 * 24 * time.Hour

	settingDigestSentAt     = "notify_digest_sent_at"
	settingInactivitySentAt = "notify_inactivity_sent_at"
	settingWeeklySentAt     = "notify_weekly_sent_at"
)

type Notifier struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Notifier { return &Notifier{db: db} }

// Start runs the checks on a ticker. The first pass is delayed so a restart
// storm doesn't mail everyone the moment the service boots.
func (n *Notifier) Start(interval time.Duration) {
	if !mailer.Enabled() {
		log.Println("📭 Notifier idle — mailer is not configured")
		return
	}
	go func() {
		time.Sleep(2 * time.Minute)
		for {
			n.RunOnce()
			time.Sleep(interval)
		}
	}()
	log.Printf("📬 Notifier running every %s", interval)
}

// RunOnce evaluates every rule for every organization.
func (n *Notifier) RunOnce() {
	var orgs []models.Organization
	if err := n.db.Where("status <> ?", models.OrgStatusInactive).Find(&orgs).Error; err != nil {
		log.Printf("📭 notifier: could not load organizations: %v", err)
		return
	}
	for i := range orgs {
		org := orgs[i]
		admins := n.adminEmails(org.ID.String())
		if len(admins) == 0 {
			continue
		}
		prefs := models.NotificationPrefsFor(&org)
		if prefs.IncidentDigest {
			n.checkIncidentDigest(&org, admins, prefs.DigestThreshold)
		}
		if prefs.InactivityAlerts {
			n.checkInactivity(&org, admins)
		}
		if prefs.WeeklySummary {
			n.checkWeeklySummary(&org, admins)
		}
	}
}

// adminEmails returns the people who should hear about org-wide security —
// admins and analysts. Managers are deliberately excluded: their view is a
// slice of the org, so an org-wide digest would misrepresent their scope.
func (n *Notifier) adminEmails(orgID string) []string {
	var users []models.User
	n.db.Where("org_id = ? AND status = ? AND role IN ?",
		orgID, models.StatusActive,
		[]models.UserRole{models.RoleOrgAdmin, models.RoleAnalyst}).
		Find(&users)

	emails := make([]string, 0, len(users))
	for _, u := range users {
		if u.Email != "" {
			emails = append(emails, u.Email)
		}
	}
	return emails
}

// lastSent reads a rate-limit marker out of the org's settings blob.
func lastSent(org *models.Organization, key string) time.Time {
	if org.Settings == nil {
		return time.Time{}
	}
	raw, ok := org.Settings[key].(string)
	if !ok {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}
	}
	return t
}

func (n *Notifier) markSent(org *models.Organization, key string) {
	if org.Settings == nil {
		org.Settings = map[string]any{}
	}
	org.Settings[key] = time.Now().Format(time.RFC3339)
	n.db.Model(org).Update("settings", org.Settings)
}

// checkIncidentDigest is the "several things happened — come and look" mail.
func (n *Notifier) checkIncidentDigest(org *models.Organization, admins []string, threshold int) {
	if time.Since(lastSent(org, settingDigestSentAt)) < digestCooldown {
		return
	}
	since := time.Now().Add(-digestCooldown)
	st, err := dataplane.Events(context.Background(), org.ID)
	if err != nil {
		return // the company's own database is unreachable; its health check emails about that
	}
	count := eventCounter(st, org.ID, since)

	blocked := count(dataplane.EventQuery{Actions: []string{"blocked"}})
	alerted := count(dataplane.EventQuery{Actions: []string{"alerted"}})
	if threshold < 1 {
		threshold = digestThreshold
	}
	if blocked+alerted < threshold {
		return
	}

	dlp := count(dataplane.EventQuery{Categories: []string{"dlp"}})
	malware := count(dataplane.EventQuery{Categories: []string{"malware_detection"}})

	var pending int64
	n.db.Model(&models.AccessRequest{}).
		Where("org_id = ? AND status = ?", org.ID, "pending").Count(&pending)

	top := topDomains(st, org.ID, since)

	mailer.ActivityDigest(admins, org.Name, int(digestCooldown.Hours()),
		blocked, alerted, dlp, malware, int(pending), top)
	n.markSent(org, settingDigestSentAt)
}

// checkInactivity flags an org whose agents have stopped reporting. An org that
// never enrolled anything is skipped — there is nothing to have gone quiet.
func (n *Notifier) checkInactivity(org *models.Organization, admins []string) {
	if time.Since(lastSent(org, settingInactivitySentAt)) < inactivityCooldown {
		return
	}

	var devices int64
	n.db.Model(&models.Device{}).Where("org_id = ?", org.ID).Count(&devices)
	if devices == 0 {
		return
	}

	// Never claim "no activity" without being able to look: a company whose
	// own database is unreachable hears about that from the health check.
	st, err := dataplane.Events(context.Background(), org.ID)
	if err != nil {
		return
	}
	recent, err := st.CountEvents(context.Background(), dataplane.EventQuery{
		OrgID: org.ID, Since: time.Now().AddDate(0, 0, -inactivityDays), Limit: 1,
	})
	if err != nil || recent > 0 {
		return
	}

	var online int64
	n.db.Model(&models.Device{}).Where("org_id = ? AND status = ?", org.ID, "online").Count(&online)

	mailer.NoActivityNotice(admins, org.Name, inactivityDays, int(devices), int(online))
	n.markSent(org, settingInactivitySentAt)

	// The employees whose own devices went silent hear about it too — they're
	// the only ones who can actually restart an agent on their laptop.
	n.notifyQuietEmployees(org)
}

func (n *Notifier) notifyQuietEmployees(org *models.Organization) {
	type row struct {
		Email     string
		FirstName string
	}
	var rows []row
	n.db.Raw(`SELECT DISTINCT e.email, e.first_name
		FROM employees e
		JOIN devices d ON d.employee_id = e.id AND d.deleted_at IS NULL
		WHERE e.org_id = ? AND e.status = 'active' AND e.email <> ''
		  AND (d.last_seen_at IS NULL OR d.last_seen_at < ?)
		LIMIT 200`, org.ID, time.Now().AddDate(0, 0, -inactivityDays)).Scan(&rows)

	for _, r := range rows {
		mailer.EmployeeInactivityNotice(r.Email, r.FirstName, org.Name, inactivityDays)
	}
}

// checkWeeklySummary sends the routine report — including in a quiet week, so
// admins can tell "nothing happened" from "nothing was reported".
func (n *Notifier) checkWeeklySummary(org *models.Organization, admins []string) {
	if time.Since(lastSent(org, settingWeeklySentAt)) < weeklyCooldown {
		return
	}
	since := time.Now().AddDate(0, 0, -7)
	st, err := dataplane.Events(context.Background(), org.ID)
	if err != nil {
		return
	}
	count := eventCounter(st, org.ID, since)

	var employees, devices int64
	n.db.Model(&models.Employee{}).Where("org_id = ?", org.ID).Count(&employees)
	n.db.Model(&models.Device{}).Where("org_id = ?", org.ID).Count(&devices)

	top := topDomains(st, org.ID, since)

	mailer.WeeklySummary(admins, org.Name,
		count(dataplane.EventQuery{Actions: []string{"blocked"}}), count(dataplane.EventQuery{Actions: []string{"alerted"}}),
		count(dataplane.EventQuery{Categories: []string{"dlp"}}), int(employees), int(devices), top)
	n.markSent(org, settingWeeklySentAt)
}

// eventCounter counts an org's events since a moment, narrowed by f.
func eventCounter(st dataplane.Store, orgID uuid.UUID, since time.Time) func(f dataplane.EventQuery) int {
	return func(f dataplane.EventQuery) int {
		f.OrgID, f.Since = orgID, since
		n, _ := st.CountEvents(context.Background(), f)
		return int(n)
	}
}

// topDomains is the five sites most often blocked or flagged since a moment.
func topDomains(st dataplane.Store, orgID uuid.UUID, since time.Time) []string {
	groups, _ := st.GroupEvents(context.Background(), dataplane.EventQuery{
		OrgID: orgID, Since: since, HasTargetDomain: true, Actions: []string{"blocked", "alerted"},
	}, "target_domain", 5)
	top := make([]string, 0, len(groups))
	for _, g := range groups {
		top = append(top, g.Key)
	}
	return top
}

// AdminEmails is the exported lookup handlers use for immediate alerts.
func AdminEmails(db *gorm.DB, orgID string) []string {
	return (&Notifier{db: db}).adminEmails(orgID)
}
