package handlers

// Repeated reports of one action fold into one activity row, against a real
// Postgres (the folding query uses jsonb and advisory locks). Opt-in: set
// EVENTS_IT_DSN to a THROWAWAY database (its public schema is wiped), e.g.
//   docker run --rm -e POSTGRES_PASSWORD=it -e POSTGRES_DB=it -p 56790:5432 postgres:16-alpine
//   EVENTS_IT_DSN="host=127.0.0.1 port=56790 user=postgres password=it dbname=it sslmode=disable" go test ./internal/handlers -run TestEventDedupe

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestEventDedupeIntegration(t *testing.T) {
	dsn := os.Getenv("EVENTS_IT_DSN")
	if dsn == "" {
		t.Skip("EVENTS_IT_DSN not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableForeignKeyConstraintWhenMigrating: true})
	if err != nil {
		t.Fatal(err)
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(db.Exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).Error)
	enums, err := os.ReadFile("../../../../infra/postgres/init-enums.sql")
	must(err)
	must(db.Exec(string(enums)).Error)
	must(db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error)
	must(db.AutoMigrate(&models.ActivityEvent{}, &models.OrgDataResidency{}))
	dataplane.Init(db, nil)
	ctx := context.Background()

	org := uuid.New()
	dev := uuid.New()
	other := uuid.New()
	t0 := time.Now().Add(-time.Hour)
	ev := func(device uuid.UUID, typ models.EventType, action models.EventAction, at time.Time, meta map[string]any) *models.ActivityEvent {
		return &models.ActivityEvent{OrgID: org, DeviceID: &device, EventType: typ, Action: action, Timestamp: at, Metadata: meta}
	}
	rows := func(key string) []models.ActivityEvent {
		var out []models.ActivityEvent
		must(db.Where("metadata->>'dedupe_key' = ?", key).Order("timestamp").Find(&out).Error)
		return out
	}

	// Gmail autosave: six saves of one draft within 40s → one incident, which
	// ends up with the highest score seen.
	key := dlpTextDedupeKey("mail.google.com", "/sync/u/1/i/s", []string{"ai_text"})
	for i, score := range []float64{67, 67, 70, 67, 92, 67} {
		e := ev(dev, models.EventTypePolicyViol, models.EventActionAlerted, t0.Add(time.Duration(i*8)*time.Second),
			map[string]any{"score": score, "band": "alert"})
		e.RiskScore = score
		_, _, err := dataplane.RecordDeduped(ctx, org, e, key, dlpTextDedupeWindow, keepWorstDLP)
		must(err)
	}
	got := rows(key)
	if len(got) != 1 {
		t.Fatalf("autosaved draft stored %d rows, want 1", len(got))
	}
	if dataplane.RepeatCount(got[0].Metadata) != 6 || got[0].RiskScore != 92 {
		t.Fatalf("kept row: repeat=%v score=%v, want 6 and 92", got[0].Metadata["repeat_count"], got[0].RiskScore)
	}
	if !got[0].Timestamp.Equal(t0) && got[0].Timestamp.Sub(t0).Abs() > time.Millisecond {
		t.Fatalf("kept row should keep the first timestamp, got %v", got[0].Timestamp)
	}

	// The window slides from the last repeat, but a real gap starts a new row.
	_, dup, err := dataplane.RecordDeduped(ctx, org, ev(dev, models.EventTypePolicyViol, models.EventActionAlerted, t0.Add(40*time.Second+dlpTextDedupeWindow-time.Second), map[string]any{}), key, dlpTextDedupeWindow, keepWorstDLP)
	must(err)
	if !dup {
		t.Fatal("a repeat inside the sliding window should fold")
	}
	_, dup, err = dataplane.RecordDeduped(ctx, org, ev(dev, models.EventTypePolicyViol, models.EventActionAlerted, t0.Add(30*time.Minute), map[string]any{}), key, dlpTextDedupeWindow, keepWorstDLP)
	must(err)
	if dup || len(rows(key)) != 2 {
		t.Fatal("the same finding half an hour later is a new incident")
	}

	// Same key on another device is never folded.
	_, dup, err = dataplane.RecordDeduped(ctx, org, ev(other, models.EventTypePolicyViol, models.EventActionAlerted, t0, map[string]any{}), key, dlpTextDedupeWindow, keepWorstDLP)
	must(err)
	if dup {
		t.Fatal("events from different devices must not fold")
	}

	// VPN extension found in three Chrome profiles → one row listing them.
	extKey := "ext|majdfhpaihoncoakbjgbdhglocklcgno|installed"
	for i, p := range []string{"Default", "Profile 2", "Profile 10"} {
		_, _, err := dataplane.RecordDeduped(ctx, org, ev(dev, models.EventTypeProcessStart, models.EventActionAlerted, t0.Add(time.Duration(i)*500*time.Millisecond),
			map[string]any{"profile": p}), extKey, extensionDedupeWindow, mergeExtensionProfiles)
		must(err)
	}
	got = rows(extKey)
	if len(got) != 1 {
		t.Fatalf("extension stored %d rows, want 1", len(got))
	}
	if profiles, _ := got[0].Metadata["profiles"].([]any); len(profiles) != 3 {
		t.Fatalf("profiles = %v, want all three", got[0].Metadata["profiles"])
	}

	// A blocked page retried 8s later is one block; a different action
	// (alerted vs blocked) on the same host is not folded into it.
	web := &models.ActivityEvent{Target: "https://payroll.razorpay.com"}
	webKey := webDedupeKey(web)
	if webKey != "web|payroll.razorpay.com" {
		t.Fatalf("webDedupeKey = %q", webKey)
	}
	for _, d := range []time.Duration{0, 8 * time.Second} {
		_, _, err := dataplane.RecordDeduped(ctx, org, ev(dev, models.EventTypeWebRequest, models.EventActionBlocked, t0.Add(d), nil), webKey, webBlockDedupeWindow, nil)
		must(err)
	}
	_, dup, err = dataplane.RecordDeduped(ctx, org, ev(dev, models.EventTypeWebRequest, models.EventActionAlerted, t0.Add(9*time.Second), nil), webKey, webBlockDedupeWindow, nil)
	must(err)
	if dup || len(rows(webKey)) != 2 {
		t.Fatalf("web rows = %d (dup=%v), want 2: one folded block, one alert", len(rows(webKey)), dup)
	}
}
