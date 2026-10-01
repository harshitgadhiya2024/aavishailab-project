package handlers

import (
	"log"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// One action on a laptop often reaches us as several reports: Gmail autosaves
// a draft every few seconds (each save is a full DLP scan), a VPN extension is
// installed once per Chrome profile, an app's helper processes are each
// stopped, and a browser retries a blocked page. Stored one row each, the
// Activity tab showed the same thing 2–6 times in a row.
//
// recordDeduped folds such a report into the matching recent row instead:
// same device, same event type and action, same dedupe key, and the previous
// copy (or the last one folded into it) within `window`. The row keeps its
// first timestamp and gains metadata.repeat_count / metadata.last_seen_at, so
// nothing is lost — "6 times in 40 seconds" is still visible. The window
// slides: a draft being written for five minutes stays one incident.
//
// merge, when set, lets the caller fold details of the new report into the
// kept row (e.g. a higher DLP score, another browser profile).

const (
	webBlockDedupeWindow  = 60 * time.Second
	appBlockDedupeWindow  = 60 * time.Second
	extensionDedupeWindow = 10 * time.Minute
	dlpTextDedupeWindow   = 2 * time.Minute
)

type dedupeMerge func(kept *models.ActivityEvent, next *models.ActivityEvent)

func recordDeduped(db *gorm.DB, ev *models.ActivityEvent, key string, window time.Duration, merge dedupeMerge) (uuid.UUID, bool, error) {
	if ev.DeviceID == nil || key == "" {
		return uuid.Nil, false, db.Create(ev).Error
	}
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now()
	}
	if ev.Metadata == nil {
		ev.Metadata = map[string]any{}
	}
	ev.Metadata["dedupe_key"] = key

	var kept models.ActivityEvent
	dup := false
	err := db.Transaction(func(tx *gorm.DB) error {
		// Two copies arriving together must not both see "nothing yet".
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "event-dedupe:"+ev.DeviceID.String()+":"+key).Error; err != nil {
			return err
		}
		since := ev.Timestamp.Add(-window)
		q := tx.Where(`device_id = ? AND event_type = ? AND action = ? AND metadata->>'dedupe_key' = ?
			AND timestamp > ? AND COALESCE((metadata->>'last_seen_at')::timestamptz, timestamp) > ?`,
			*ev.DeviceID, ev.EventType, ev.Action, key, ev.Timestamp.Add(-24*time.Hour), since).
			Order("timestamp DESC").Limit(1).Find(&kept)
		if q.Error != nil {
			return q.Error
		}
		if q.RowsAffected == 0 {
			return tx.Create(ev).Error
		}
		dup = true
		if kept.Metadata == nil {
			kept.Metadata = map[string]any{}
		}
		kept.Metadata["repeat_count"] = repeatCount(kept.Metadata) + 1
		kept.Metadata["last_seen_at"] = ev.Timestamp.UTC().Format(time.RFC3339Nano)
		if merge != nil {
			merge(&kept, ev)
		}
		return tx.Model(&kept).Select("metadata", "risk_score", "target", "policy_id", "policy_name").Updates(&kept).Error
	})
	if err != nil {
		// Never lose an event to the de-duplication itself.
		log.Printf("event dedupe failed (%v) — recording anyway", err)
		return uuid.Nil, false, db.Create(ev).Error
	}
	return kept.ID, dup, nil
}

// repeatCount is how many reports a row already stands for (1 when none were
// folded into it yet). JSON numbers come back as float64.
func repeatCount(meta map[string]any) int {
	switch v := meta["repeat_count"].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return 1
}

// webDedupeKey: the blocked host, so http://x, https://x and https://www.x/
// retried seconds apart are one block.
func webDedupeKey(ev *models.ActivityEvent) string {
	host := ev.TargetDomain
	if host == "" {
		if u, err := url.Parse(ev.Target); err == nil && u.Host != "" {
			host = u.Hostname()
		} else {
			host = ev.Target
		}
	}
	host = normDomain(host)
	if host == "" {
		return ""
	}
	return "web|" + host
}

// dlpTextDedupeKey: the same kinds of finding going to the same place on the
// same channel. Autosaved drafts differ slightly every time (the text grows,
// and the AI words its explanation differently), so the content itself can't
// be the key.
func dlpTextDedupeKey(site, path string, detectors []string) string {
	d := append([]string(nil), detectors...)
	sort.Strings(d)
	return "dlp-text|" + strings.ToLower(site) + "|" + strings.SplitN(path, "?", 2)[0] + "|" + strings.Join(d, ",")
}

// keepWorstDLP keeps the most severe version of a repeated DLP finding: a
// draft that gains a card number half-way through must end up scored as one.
func keepWorstDLP(kept, next *models.ActivityEvent) {
	if next.RiskScore <= kept.RiskScore {
		return
	}
	kept.RiskScore = next.RiskScore
	kept.PolicyID = next.PolicyID
	kept.PolicyName = next.PolicyName
	for _, k := range []string{"score", "band", "matches"} {
		if v, ok := next.Metadata[k]; ok {
			kept.Metadata[k] = v
		}
	}
	if kept.Target == "" {
		kept.Target = next.Target
	}
}

// mergeExtensionProfiles records every browser profile the extension was found
// in on the one row.
func mergeExtensionProfiles(kept, next *models.ActivityEvent) {
	seen := map[string]bool{}
	var profiles []string
	add := func(p any) {
		s, _ := p.(string)
		if s != "" && !seen[s] {
			seen[s] = true
			profiles = append(profiles, s)
		}
	}
	if list, ok := kept.Metadata["profiles"].([]any); ok {
		for _, p := range list {
			add(p)
		}
	}
	add(kept.Metadata["profile"])
	add(next.Metadata["profile"])
	kept.Metadata["profiles"] = profiles
}
