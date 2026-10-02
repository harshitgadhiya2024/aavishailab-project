package dataplane

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
)

// The spool holds events for an organization whose own database is briefly
// unreachable — a restart, a failover, a firewall change — and delivers them
// once it answers again.
//
// It is the one place a company's employee data rests on Aavishield's side
// after data residency is on, so it is kept as small and short-lived as it
// can be: each batch is sealed with the same AES-256-GCM key as the
// connection credentials, it lives in Redis (never in Aavishield's database),
// it expires after spoolTTL, and it is capped at spoolMaxBatches. The
// settings page shows how much is waiting.
//
// Screenshots are not spooled: an image is far larger than an event, and a
// missed capture during an outage loses a sample, not a security incident.

const (
	spoolPrefix     = "dataplane:spool:"
	spoolTTL        = 72 * time.Hour
	spoolMaxBatches = 20000
	flushEvery      = 30 * time.Second
	flushBatches    = 50
)

func spoolKey(orgID uuid.UUID) string { return spoolPrefix + orgID.String() }

func spoolEvents(ctx context.Context, orgID uuid.UUID, events []*models.ActivityEvent, cause error) error {
	m := mgr()
	if m.rdb == nil {
		return cause
	}
	for _, ev := range events {
		if ev.ID == uuid.Nil {
			ev.ID = uuid.New()
		}
		if ev.CreatedAt.IsZero() {
			ev.CreatedAt = time.Now()
		}
	}
	raw, err := json.Marshal(spooledBatch{Events: events, DedupeKeys: dedupeKeys(events)})
	if err != nil {
		return cause
	}
	sealed, err := Seal(raw)
	if err != nil {
		return cause
	}
	key := spoolKey(orgID)
	pipe := m.rdb.TxPipeline()
	pipe.LPush(ctx, key, sealed)
	pipe.LTrim(ctx, key, 0, spoolMaxBatches-1)
	pipe.Expire(ctx, key, spoolTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		log.Printf("dataplane: org %s database unreachable and spool failed (%v) — %d event(s) lost: %v", orgID, err, len(events), cause)
		return cause
	}
	log.Printf("dataplane: org %s database unreachable, %d event(s) held for delivery: %v", orgID, len(events), cause)
	return nil
}

// spooledBatch carries DedupeKey alongside the events: the field is not part
// of ActivityEvent's JSON (it is internal), and the delivered rows must keep
// it so later reports still fold into them.
type spooledBatch struct {
	Events     []*models.ActivityEvent `json:"events"`
	DedupeKeys []string                `json:"dedupe_keys"`
}

func dedupeKeys(events []*models.ActivityEvent) []string {
	out := make([]string, len(events))
	for i, ev := range events {
		out[i] = ev.DedupeKey
	}
	return out
}

// SpoolDepth is how many batches are waiting for an org.
func SpoolDepth(ctx context.Context, orgID uuid.UUID) int64 {
	m := mgr()
	if m.rdb == nil {
		return 0
	}
	n, _ := m.rdb.LLen(ctx, spoolKey(orgID)).Result()
	return n
}

// StartSpoolFlusher delivers held events once their database is reachable.
func StartSpoolFlusher() {
	go func() {
		ticker := time.NewTicker(flushEvery)
		defer ticker.Stop()
		for range ticker.C {
			flushSpools(context.Background())
		}
	}()
}

func flushSpools(ctx context.Context) {
	m := mgr()
	if m.rdb == nil {
		return
	}
	var cursor uint64
	for {
		keys, next, err := m.rdb.Scan(ctx, cursor, spoolPrefix+"*", 100).Result()
		if err != nil {
			return
		}
		for _, k := range keys {
			if orgID, err := uuid.Parse(strings.TrimPrefix(k, spoolPrefix)); err == nil {
				if n, err := flushOrg(ctx, orgID); err != nil {
					log.Printf("dataplane: org %s spool not delivered yet: %v", orgID, err)
				} else if n > 0 {
					log.Printf("dataplane: org %s delivered %d held event(s)", orgID, n)
				}
			}
		}
		if next == 0 {
			return
		}
		cursor = next
	}
}

// flushOrg delivers the oldest held batches, oldest first. A batch is removed
// only after it was written, so a failure part-way leaves the rest in place.
func flushOrg(ctx context.Context, orgID uuid.UUID) (int, error) {
	m := mgr()
	st, tenant, err := m.resolve(ctx, orgID)
	if err != nil {
		return 0, err
	}
	if !tenant {
		// Data residency was switched off while events were held. They were
		// meant for the company's database and are not moved into
		// Aavishield's; they expire with the spool.
		return 0, nil
	}
	key := spoolKey(orgID)
	items, err := m.rdb.LRange(ctx, key, -flushBatches, -1).Result()
	if err != nil {
		return 0, err
	}
	delivered, events := 0, 0
	// LPUSH puts the newest at the head, so the tail is the oldest; walk the
	// fetched slice from its end.
	for i := len(items) - 1; i >= 0; i-- {
		raw, err := Open(items[i])
		if err != nil {
			delivered++ // unreadable (key rotated): drop it rather than block the queue
			continue
		}
		var b spooledBatch
		if err := json.Unmarshal(raw, &b); err != nil {
			delivered++
			continue
		}
		for j, ev := range b.Events {
			if j < len(b.DedupeKeys) {
				ev.DedupeKey = b.DedupeKeys[j]
			}
		}
		if err := st.InsertEvents(ctx, b.Events); err != nil {
			if !isDuplicateKey(err) {
				break
			}
			// Some of the batch was written before (the trim after it was
			// lost): write the rest one by one, skipping what is there.
			failed := false
			for _, ev := range b.Events {
				if err := st.InsertEvents(ctx, []*models.ActivityEvent{ev}); err != nil && !isDuplicateKey(err) {
					failed = true
					break
				}
			}
			if failed {
				break
			}
		}
		delivered++
		events += len(b.Events)
	}
	if delivered > 0 {
		if err := m.rdb.LTrim(ctx, key, 0, int64(-delivered-1)).Err(); err != nil {
			return events, err
		}
	}
	if delivered < len(items) {
		return events, fmt.Errorf("%d batch(es) still waiting", len(items)-delivered)
	}
	return events, nil
}

func isDuplicateKey(err error) bool {
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "duplicate") || strings.Contains(s, "unique constraint") ||
		strings.Contains(s, "e11000") || strings.Contains(s, "violation of primary key")
}
