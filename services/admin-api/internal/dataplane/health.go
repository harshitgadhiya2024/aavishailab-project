package dataplane

import (
	"context"
	"log"
	"time"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
)

// StartHealthChecks re-tests every connected company store on a timer and
// records the result on the settings page. Admins are emailed when a store
// stops answering and again when it is back — they would otherwise only find
// out from an empty dashboard.
//
// A store is reported unreachable only after failing two checks in a row, so
// one dropped packet doesn't page anybody.
func StartHealthChecks(interval time.Duration) {
	go func() {
		time.Sleep(time.Minute)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			checkAll(context.Background())
			<-ticker.C
		}
	}()
}

var failStreak = map[string]int{}

func checkAll(ctx context.Context) {
	m := mgr()
	var rows []models.OrgDataResidency
	if err := m.db.Where("enabled = true").Find(&rows).Error; err != nil {
		return
	}
	for i := range rows {
		r := &rows[i]
		if r.DBActive() {
			err := checkDB(ctx, r.OrgID)
			record(ctx, r, "db", "database", err)
		}
		if r.FilesActive() {
			err := checkFiles(ctx, r.OrgID)
			record(ctx, r, "files", "file storage", err)
		}
	}
}

func checkDB(ctx context.Context, orgID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	// Through a fresh connection attempt, not the cached error, so a store
	// that just came back is noticed now rather than after retryAfter.
	m := mgr()
	m.mu.Lock()
	if e := m.entries[orgID]; e != nil {
		e.dbErr = nil
	}
	m.mu.Unlock()
	st, _, err := m.resolve(ctx, orgID)
	if err != nil {
		return err
	}
	return st.Ping(ctx)
}

func checkFiles(ctx context.Context, orgID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	m := mgr()
	m.mu.Lock()
	if e := m.entries[orgID]; e != nil {
		e.filesErr = nil
	}
	m.mu.Unlock()
	b, _, err := m.tenantFiles(ctx, orgID)
	if err != nil {
		return err
	}
	key := "aavishield-healthcheck/ping.txt"
	if err := b.Put(ctx, key, "text/plain", []byte(time.Now().UTC().Format(time.RFC3339))); err != nil {
		return err
	}
	return b.Delete(key)
}

func record(ctx context.Context, r *models.OrgDataResidency, kind, label string, err error) {
	m := mgr()
	now := time.Now()
	streakKey := r.OrgID.String() + ":" + kind
	prev := r.DBStatus
	if kind == "files" {
		prev = r.FilesStatus
	}

	status, detail := models.ResidencyStatusConnected, ""
	if err != nil {
		failStreak[streakKey]++
		detail = err.Error()
		if failStreak[streakKey] < 2 && prev != models.ResidencyStatusUnreachable {
			return
		}
		status = models.ResidencyStatusUnreachable
	} else {
		failStreak[streakKey] = 0
	}

	updates := map[string]any{kind + "_status": status, kind + "_error": detail, kind + "_checked_at": now}
	m.db.Model(&models.OrgDataResidency{}).Where("id = ?", r.ID).Updates(updates)
	if prev == status {
		return
	}
	Invalidate(r.OrgID)

	var org models.Organization
	m.db.Select("name").First(&org, "id = ?", r.OrgID)
	admins := adminEmails(r.OrgID)
	if status == models.ResidencyStatusUnreachable {
		log.Printf("dataplane: org %s %s unreachable: %s", r.OrgID, label, detail)
		mailer.DataStoreUnreachable(admins, org.Name, label, detail)
	} else if prev == models.ResidencyStatusUnreachable {
		log.Printf("dataplane: org %s %s reachable again", r.OrgID, label)
		mailer.DataStoreRecovered(admins, org.Name, label)
	}
}

func adminEmails(orgID uuid.UUID) []string {
	var users []models.User
	mgr().db.Where("org_id = ? AND status = ? AND role = ?", orgID, models.StatusActive, models.RoleOrgAdmin).Find(&users)
	out := make([]string, 0, len(users))
	for _, u := range users {
		if u.Email != "" {
			out = append(out, u.Email)
		}
	}
	return out
}
