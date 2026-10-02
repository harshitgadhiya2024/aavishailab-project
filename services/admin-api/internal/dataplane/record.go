package dataplane

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"hash/fnv"
	"log"
	"sync"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
)

// RecordEvents stores events for an org. When the org's own database cannot
// be reached, the events are held in the spool (see spool.go) and delivered
// once it is back, and RecordEvents still succeeds: the agent that sent them
// does not retry, so refusing them would lose security incidents to a
// customer's maintenance window.
func RecordEvents(ctx context.Context, orgID uuid.UUID, events ...*models.ActivityEvent) error {
	if len(events) == 0 {
		return nil
	}
	st, tenant, err := mgr().resolve(ctx, orgID)
	if err == nil {
		if err = st.InsertEvents(ctx, events); err == nil {
			return nil
		}
	}
	if !tenant {
		return err
	}
	return spoolEvents(ctx, orgID, events, err)
}

// Merge folds a repeated report into the row already standing for it.
type Merge func(kept, next *models.ActivityEvent)

// maxDedupeKey bounds the key so it fits an indexed column on every engine;
// longer keys are replaced by a stable digest.
const maxDedupeKey = 200

func normalizeDedupeKey(key string) string {
	if len(key) <= maxDedupeKey {
		return key
	}
	sum := sha256.Sum256([]byte(key))
	return key[:40] + "#" + hex.EncodeToString(sum[:])
}

// RecordDeduped stores ev unless it repeats a report the same device made
// within window — same event type, action and dedupe key, and the earlier
// row (or the last report folded into it) still inside the window. A repeat
// is folded into that row instead: metadata.repeat_count goes up,
// metadata.last_seen_at moves forward, and merge may carry details across.
// The window slides, so a draft autosaved for five minutes stays one incident.
//
// Returns the kept row's ID and true for a fold. It never loses an event to
// the folding itself: any failure there records ev as a new row.
func RecordDeduped(ctx context.Context, orgID uuid.UUID, ev *models.ActivityEvent, key string, window time.Duration, merge Merge) (uuid.UUID, bool, error) {
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now()
	}
	if ev.DeviceID == nil || key == "" {
		return uuid.Nil, false, RecordEvents(ctx, orgID, ev)
	}
	key = normalizeDedupeKey(key)
	if ev.Metadata == nil {
		ev.Metadata = map[string]any{}
	}
	ev.Metadata["dedupe_key"] = key
	ev.DedupeKey = key

	st, tenant, err := mgr().resolve(ctx, orgID)
	if err != nil {
		if tenant {
			return uuid.Nil, false, spoolEvents(ctx, orgID, []*models.ActivityEvent{ev}, err)
		}
		return uuid.Nil, false, err
	}

	// Two copies arriving together must not both see "nothing yet".
	unlock := lockKey(ctx, "event-dedupe:"+ev.DeviceID.String()+":"+key)
	defer unlock()

	since := ev.Timestamp.Add(-window)
	candidates, err := st.FindEvents(ctx, EventQuery{
		OrgID:      orgID,
		DeviceID:   ev.DeviceID,
		EventTypes: []string{string(ev.EventType)},
		Actions:    []string{string(ev.Action)},
		DedupeKey:  key,
		Since:      ev.Timestamp.Add(-24 * time.Hour),
		Limit:      20,
	})
	if err != nil {
		log.Printf("event dedupe lookup failed (%v) — recording anyway", err)
		return uuid.Nil, false, RecordEvents(ctx, orgID, ev)
	}
	var kept *models.ActivityEvent
	for i := range candidates {
		if lastSeen(&candidates[i]).After(since) {
			kept = &candidates[i]
			break
		}
	}
	if kept == nil {
		return uuid.Nil, false, RecordEvents(ctx, orgID, ev)
	}

	if kept.Metadata == nil {
		kept.Metadata = map[string]any{}
	}
	kept.Metadata["repeat_count"] = RepeatCount(kept.Metadata) + 1
	kept.Metadata["last_seen_at"] = ev.Timestamp.UTC().Format(time.RFC3339Nano)
	if merge != nil {
		merge(kept, ev)
	}
	if err := st.UpdateEvent(ctx, kept, "metadata", "risk_score", "target", "policy_id", "policy_name"); err != nil {
		log.Printf("event dedupe update failed (%v) — recording anyway", err)
		return uuid.Nil, false, RecordEvents(ctx, orgID, ev)
	}
	return kept.ID, true, nil
}

// lastSeen is when a row was last reported: metadata.last_seen_at once
// something was folded into it, its own timestamp before that.
func lastSeen(ev *models.ActivityEvent) time.Time {
	if s, ok := ev.Metadata["last_seen_at"].(string); ok {
		if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
			return t
		}
	}
	return ev.Timestamp
}

// RepeatCount is how many reports a row already stands for (1 when none were
// folded into it yet). JSON numbers come back as float64.
func RepeatCount(meta map[string]any) int {
	switch v := meta["repeat_count"].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	}
	return 1
}

// ─── Locks ────────────────────────────────────────────────────────────────────

// lockKey serialises work on one key across goroutines and — through Redis,
// when it is reachable — across admin-api instances. It replaces the
// pg_advisory_xact_lock the folding used when every event lived in Postgres.
// Never blocks for long and never fails: past the wait it proceeds unlocked,
// because a duplicate row is a far better outcome than a dropped event.
func lockKey(ctx context.Context, key string) func() {
	mu := &localLocks[stripe(key)]
	mu.Lock()

	m := std
	if m == nil || m.rdb == nil {
		return mu.Unlock
	}
	token := uuid.NewString()
	rkey := "lock:" + key
	deadline := time.Now().Add(3 * time.Second)
	for {
		ok, err := m.rdb.SetNX(ctx, rkey, token, 10*time.Second).Result()
		if err != nil || ok {
			if err != nil {
				return mu.Unlock
			}
			return func() {
				// Release only our own lock — compare-and-delete.
				m.rdb.Eval(context.Background(),
					`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
					[]string{rkey}, token)
				mu.Unlock()
			}
		}
		if time.Now().After(deadline) || errors.Is(ctx.Err(), context.Canceled) {
			return mu.Unlock
		}
		time.Sleep(25 * time.Millisecond)
	}
}

var localLocks [64]sync.Mutex

func stripe(key string) uint32 {
	h := fnv.New32a()
	h.Write([]byte(key))
	return h.Sum32() % uint32(len(localLocks))
}
