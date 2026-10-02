package dataplane

// End to end: a company switches data residency on and its employee data
// goes to its own database and bucket — never to Aavishield's — survives an
// outage of its database, has its history moved over, and goes back to
// Aavishield when switched off.
//
// Uses the containers from conformance_test.go plus Redis, and a fresh
// Postgres database for Aavishield's own side:
//
//   docker run -d --rm --name dp-redis -p 56808:6379 redis:7-alpine
//   docker exec dp-pg psql -U postgres -c "CREATE DATABASE routing_it"
//   DATAPLANE_IT=1 go test ./internal/dataplane -run Routing -v

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/storage"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestRouting(t *testing.T) {
	if os.Getenv("DATAPLANE_IT") == "" {
		t.Skip("DATAPLANE_IT not set")
	}
	t.Setenv("DATA_RESIDENCY_ALLOW_PRIVATE_NETWORKS", "true")
	t.Setenv("CA_KEY_ENCRYPTION_KEY", "routing-test-key-0123456789abcdefghijklmnop")
	t.Setenv("SCREENSHOT_LOCAL_DIR", t.TempDir())
	t.Setenv("SCREENSHOT_R2_ENDPOINT", "")
	ctx := context.Background()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}

	// ── Aavishield's own side ──
	db, err := gorm.Open(postgres.Open("host=127.0.0.1 port=56801 user=postgres password=it dbname=routing_it sslmode=disable"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableForeignKeyConstraintWhenMigrating: true})
	must(err)
	must(db.Exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).Error)
	enums, err := os.ReadFile("../../../../infra/postgres/init-enums.sql")
	must(err)
	must(db.Exec(string(enums)).Error)
	must(db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error)
	must(db.AutoMigrate(&models.ActivityEvent{}, &models.WorkSession{}, &models.Screenshot{},
		&models.OrgDataResidency{}, &models.Organization{}, &models.User{}))
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:56808"})
	must(rdb.FlushDB(ctx).Err())
	Init(db, rdb)

	org := uuid.New()
	dev := uuid.New()
	ev := func(target string) *models.ActivityEvent {
		return &models.ActivityEvent{OrgID: org, DeviceID: &dev, EventType: models.EventTypeWebRequest,
			Action: models.EventActionBlocked, TargetDomain: target, Timestamp: time.Now()}
	}
	primaryCount := func() int64 {
		var n int64
		db.Model(&models.ActivityEvent{}).Where("org_id = ?", org).Count(&n)
		return n
	}

	// History recorded before the switch: 3 events and a screenshot whose
	// image is in Aavishield's storage.
	must(RecordEvents(ctx, org, ev("old-1.example.com"), ev("old-2.example.com"), ev("old-3.example.com")))
	oldKey, err := PutFile(ctx, org, "screenshots/"+org.String()+"/old.webp", "image/webp", []byte("old image"))
	must(err)
	if IsTenantKey(oldKey) {
		t.Fatal("before the switch, images must go to Aavishield's storage")
	}
	must(Primary().InsertScreenshot(ctx, &models.Screenshot{OrgID: org, CapturedAt: time.Now().Add(-time.Hour), StorageKey: oldKey}))
	if primaryCount() != 3 {
		t.Fatalf("history in primary = %d", primaryCount())
	}

	// ── The company connects its own MySQL and bucket ──
	tenantDB := DBConfig{Provider: models.ResidencyDBMySQL, Host: "127.0.0.1", Port: 56802, Database: "it", Username: "root", Password: "it", TLS: "disable"}
	tenantDB.Normalize()
	files := FilesConfig{Provider: models.ResidencyFilesS3Compatible, Bucket: "aavishield-it", Endpoint: "http://127.0.0.1:56805",
		AccessKeyID: "minioadmin", SecretAccessKey: "minioadmin", PathStyle: true, Prefix: "routing-" + org.String()[:8]}
	files.Normalize()
	storage.NewS3(storage.S3Config{Endpoint: files.Endpoint, Region: files.Region, Bucket: files.Bucket,
		AccessKey: files.AccessKeyID, SecretKey: files.SecretAccessKey, PathStyle: true}).Put(ctx, "", "", nil)
	if c := TestDB(ctx, &tenantDB); !c.OK {
		t.Fatalf("tenant db: %+v", c)
	}
	seal := func(v any) string {
		raw, _ := json.Marshal(v)
		s, err := Seal(raw)
		must(err)
		return s
	}
	row := models.OrgDataResidency{
		OrgID: org, Enabled: true,
		DBProvider: tenantDB.Provider, DBConfigSealed: seal(tenantDB), DBStatus: models.ResidencyStatusConnected,
		FilesProvider: files.Provider, FilesConfigSealed: seal(files), FilesStatus: models.ResidencyStatusConnected,
		MigrationStatus: models.ResidencyMigrationIdle,
	}
	must(db.Create(&row).Error)
	Invalidate(org)

	tenant, err := Events(ctx, org)
	must(err)
	if tenant.Kind() != models.ResidencyDBMySQL {
		t.Fatalf("org resolves to %s, want the company's mysql", tenant.Kind())
	}
	tenant.DeleteEvents(ctx, EventQuery{OrgID: org})
	tenantCount := func() int64 {
		n, err := tenant.CountEvents(ctx, EventQuery{OrgID: org})
		must(err)
		return n
	}

	// New events go to the company's database, and only there.
	must(RecordEvents(ctx, org, ev("new.example.com")))
	_, dup, err := RecordDeduped(ctx, org, ev("dup.example.com"), "web|dup.example.com", time.Minute, nil)
	must(err)
	_, dup2, err := RecordDeduped(ctx, org, ev("dup.example.com"), "web|dup.example.com", time.Minute, nil)
	must(err)
	if dup || !dup2 {
		t.Fatalf("dedupe in the company's database: first dup=%v second dup=%v", dup, dup2)
	}
	if tenantCount() != 2 || primaryCount() != 3 {
		t.Fatalf("tenant=%d primary=%d — new data must land only in the company's database", tenantCount(), primaryCount())
	}

	// New images go to the company's bucket, and load through a signed link.
	newKey, err := PutFile(ctx, org, "screenshots/"+org.String()+"/new.webp", "image/webp", []byte("new image"))
	must(err)
	if !IsTenantKey(newKey) {
		t.Fatalf("key %q should point at the company's bucket", newKey)
	}
	u, err := SignedURL(ctx, org, newKey, time.Minute)
	must(err)
	if body := get(t, u); body != "new image" {
		t.Fatalf("signed link served %q", body)
	}
	// The old image still loads from Aavishield's storage.
	if _, err := SignedURL(ctx, org, oldKey, time.Minute); err != nil {
		t.Fatalf("old image no longer resolvable: %v", err)
	}

	// ── The company's database goes down ──
	down := tenantDB
	down.Port = 1
	must(db.Model(&row).Update("db_config_sealed", seal(down)).Error)
	Invalidate(org)
	if _, err := Events(ctx, org); err == nil {
		t.Fatal("an unreachable database must report ErrUnavailable")
	}
	must(RecordEvents(ctx, org, ev("during-outage.example.com"))) // accepted, held
	if SpoolDepth(ctx, org) != 1 {
		t.Fatalf("held batches = %d, want 1", SpoolDepth(ctx, org))
	}
	if primaryCount() != 3 {
		t.Fatal("during an outage nothing may be written to Aavishield's database")
	}
	raw, _ := rdb.LIndex(ctx, spoolKey(org), 0).Result()
	if len(raw) == 0 || containsPlain(raw, "during-outage.example.com") {
		t.Fatal("held events must be encrypted at rest")
	}

	// ── It comes back: held events are delivered ──
	must(db.Model(&row).Update("db_config_sealed", seal(tenantDB)).Error)
	Invalidate(org)
	tenant, err = Events(ctx, org)
	must(err)
	n, err := flushOrg(ctx, org)
	must(err)
	if n != 1 || SpoolDepth(ctx, org) != 0 || tenantCount() != 3 {
		t.Fatalf("delivered=%d held=%d tenant=%d", n, SpoolDepth(ctx, org), tenantCount())
	}

	// ── Move the history over ──
	must(MoveHistory(org))
	deadline := time.Now().Add(30 * time.Second)
	for {
		var r models.OrgDataResidency
		must(db.Where("org_id = ?", org).First(&r).Error)
		if r.MigrationStatus == models.ResidencyMigrationDone {
			break
		}
		if r.MigrationStatus == models.ResidencyMigrationFailed {
			t.Fatalf("move failed: %s", r.MigrationError)
		}
		if time.Now().After(deadline) {
			t.Fatalf("move still %s", r.MigrationStatus)
		}
		time.Sleep(200 * time.Millisecond)
	}
	if primaryCount() != 0 || tenantCount() != 6 {
		t.Fatalf("after the move: primary=%d tenant=%d, want 0 and 6", primaryCount(), tenantCount())
	}
	shots, err := tenant.FindScreenshots(ctx, ScreenshotQuery{OrgID: org})
	must(err)
	if len(shots) != 1 || !IsTenantKey(shots[0].StorageKey) {
		t.Fatalf("moved screenshots = %+v", shots)
	}
	u, err = SignedURL(ctx, org, shots[0].StorageKey, time.Minute)
	must(err)
	if body := get(t, u); body != "old image" {
		t.Fatalf("moved image serves %q", body)
	}
	if _, _, err := PrimaryFiles().Open(ctx, oldKey); err == nil {
		t.Fatal("the moved image must be deleted from Aavishield's storage")
	}
	var leftShots int64
	db.Model(&models.Screenshot{}).Where("org_id = ?", org).Count(&leftShots)
	if leftShots != 0 {
		t.Fatal("screenshot rows left in Aavishield's database")
	}
	// A second move is harmless.
	must(db.Model(&row).Update("migration_status", models.ResidencyMigrationIdle).Error)

	// ── Switched off: new data goes to Aavishield again ──
	must(db.Model(&row).Update("enabled", false).Error)
	Invalidate(org)
	st, err := Events(ctx, org)
	must(err)
	if st.Kind() != "primary" {
		t.Fatalf("switched off, the org resolves to %s", st.Kind())
	}
	must(RecordEvents(ctx, org, ev("after.example.com")))
	if primaryCount() != 1 || tenantCount() != 6 {
		t.Fatalf("after switching off: primary=%d tenant=%d", primaryCount(), tenantCount())
	}
	tenant.DeleteEvents(ctx, EventQuery{OrgID: org})
	tenant.DeleteScreenshots(ctx, ScreenshotQuery{OrgID: org})
	tenant.Close()
}

func get(t *testing.T, u string) string {
	t.Helper()
	resp, err := http.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: %d %s", u, resp.StatusCode, b)
	}
	return string(b)
}

func containsPlain(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}
