package dataplane

// Every Store must answer every query the same way, whichever engine is
// behind it — that is the whole promise of data residency. This runs one
// suite against Aavishield's own Postgres schema (the primary store) and
// against each engine a company can connect.
//
// Opt-in, against THROWAAY databases (tables are created and rows deleted):
//
//   docker run -d --rm --name dp-pg    -e POSTGRES_PASSWORD=it -e POSTGRES_DB=it -p 56801:5432 postgres:16-alpine
//   docker run -d --rm --name dp-mysql -e MYSQL_ROOT_PASSWORD=it -e MYSQL_DATABASE=it -p 56802:3306 mysql:8.4
//   docker run -d --rm --name dp-maria -e MARIADB_ROOT_PASSWORD=it -e MARIADB_DATABASE=it -p 56803:3306 mariadb:11
//   docker run -d --rm --name dp-mongo -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD=it -p 56804:27017 mongo:7
//   docker run -d --rm --name dp-mssql -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='It_Passw0rd!' -p 56807:1433 mcr.microsoft.com/mssql/server:2022-latest
//   docker run -d --rm --name dp-minio -p 56805:9000 minio/minio server /data   (then: mc mb local/aavishield-it)
//
//   DATAPLANE_IT=1 go test ./internal/dataplane -run Conformance -v
//
// Set DATAPLANE_IT_ONLY=postgres,mongodb to run a subset.

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/storage"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func itEngines() map[string]DBConfig {
	return map[string]DBConfig{
		"postgres":  {Provider: models.ResidencyDBPostgres, Host: "127.0.0.1", Port: 56801, Database: "it", Username: "postgres", Password: "it", TLS: "disable"},
		"mysql":     {Provider: models.ResidencyDBMySQL, Host: "127.0.0.1", Port: 56802, Database: "it", Username: "root", Password: "it", TLS: "disable"},
		"mariadb":   {Provider: models.ResidencyDBMariaDB, Host: "127.0.0.1", Port: 56803, Database: "it", Username: "root", Password: "it", TLS: "disable"},
		"sqlserver": {Provider: models.ResidencyDBSQLServer, Host: "127.0.0.1", Port: 56807, Database: "master", Username: "sa", Password: "It_Passw0rd!", TLS: "require"},
		"mongodb":   {Provider: models.ResidencyDBMongoDB, Host: "127.0.0.1", Port: 56804, Database: "aavishield_it", Username: "root", Password: "it", TLS: "disable"},
	}
}

func itWanted(name string) bool {
	only := os.Getenv("DATAPLANE_IT_ONLY")
	if only == "" {
		return true
	}
	for _, n := range strings.Split(only, ",") {
		if strings.TrimSpace(n) == name {
			return true
		}
	}
	return false
}

func TestConformance(t *testing.T) {
	if os.Getenv("DATAPLANE_IT") == "" {
		t.Skip("DATAPLANE_IT not set")
	}
	t.Setenv("DATA_RESIDENCY_ALLOW_PRIVATE_NETWORKS", "true")
	ctx := context.Background()

	if itWanted("primary") {
		t.Run("primary", func(t *testing.T) {
			db, err := gorm.Open(postgres.Open("host=127.0.0.1 port=56801 user=postgres password=it dbname=it sslmode=disable"),
				&gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableForeignKeyConstraintWhenMigrating: true})
			if err != nil {
				t.Fatal(err)
			}
			db.Exec(`CREATE SCHEMA IF NOT EXISTS primary_it`)
			db.Exec(`SET search_path TO primary_it, public`)
			sqlDB, _ := db.DB()
			sqlDB.SetMaxOpenConns(1) // keep the search_path on the one session
			enums, err := os.ReadFile("../../../../infra/postgres/init-enums.sql")
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Exec(string(enums)).Error; err != nil {
				t.Fatal(err)
			}
			for _, enum := range []string{"device_connect", "device_disconnect", "device_uninstall", "app_install"} {
				db.Exec(`ALTER TYPE event_type ADD VALUE IF NOT EXISTS '` + enum + `'`)
			}
			if err := db.AutoMigrate(&models.ActivityEvent{}, &models.WorkSession{}, &models.Screenshot{}); err != nil {
				t.Fatal(err)
			}
			runStoreSuite(t, newPrimaryStore(db))
		})
	}

	for name, cfg := range itEngines() {
		name, cfg := name, cfg
		if !itWanted(name) {
			continue
		}
		t.Run(name, func(t *testing.T) {
			cfg.Normalize()
			check := TestDB(ctx, &cfg)
			if !check.OK {
				t.Fatalf("connection test failed: %+v", check)
			}
			for _, s := range check.Steps {
				if !s.OK {
					t.Fatalf("step %s failed: %s", s.ID, s.Detail)
				}
			}
			st, err := connectDB(ctx, &cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			// Connecting twice must be harmless: the schema step is idempotent.
			if err := st.ensureSchema(ctx); err != nil {
				t.Fatalf("second ensureSchema: %v", err)
			}
			runStoreSuite(t, st)
			upgradeFromOlderSchema(t, st)
		})
	}

	if itWanted("s3") {
		t.Run("s3_compatible", func(t *testing.T) {
			fc := FilesConfig{
				Provider: models.ResidencyFilesS3Compatible, Bucket: "aavishield-it", Endpoint: "http://127.0.0.1:56805",
				AccessKeyID: "minioadmin", SecretAccessKey: "minioadmin", PathStyle: true, Prefix: "tenant-a",
			}
			fc.Normalize()
			// Create the bucket (path-style PUT /bucket/), as a company would
			// have before connecting it.
			storage.NewS3(storage.S3Config{Endpoint: fc.Endpoint, Region: fc.Region, Bucket: fc.Bucket,
				AccessKey: fc.AccessKeyID, SecretKey: fc.SecretAccessKey, PathStyle: true}).Put(ctx, "", "", nil)
			if c := TestFiles(ctx, &fc); !c.OK {
				t.Fatalf("files test failed: %+v", c)
			}
			bad := fc
			bad.SecretAccessKey = "wrong"
			if c := TestFiles(ctx, &bad); c.OK || len(c.Steps) < 2 || c.Steps[1].OK {
				t.Fatalf("a wrong secret must fail at the write step: %+v", c)
			}
		})
	}
}

func near(a, b time.Time) bool {
	d := a.Sub(b)
	return d < time.Millisecond && d > -time.Millisecond
}

func runStoreSuite(t *testing.T, st Store) {
	ctx := context.Background()
	org, other := uuid.New(), uuid.New()
	emp1, emp2, dev1, dev2 := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	policy := uuid.New()
	base := time.Now().UTC().Truncate(time.Second).Add(-48 * time.Hour)

	// ── Events ──
	const n = 2105 // crosses EachEvent's batch boundary
	var all []*models.ActivityEvent
	for i := 0; i < n; i++ {
		emp, dev := &emp1, &dev1
		if i%3 == 0 {
			emp, dev = &emp2, &dev2
		}
		if i%50 == 0 {
			emp = nil
		}
		ev := &models.ActivityEvent{
			OrgID: org, EmployeeID: emp, DeviceID: dev,
			EventType: models.EventTypeWebRequest, Action: models.EventActionBlocked,
			Target: fmt.Sprintf("https://site%d.example.com/page", i%7), TargetDomain: fmt.Sprintf("site%d.example.com", i%7),
			Category: "url_category", PolicyName: "Policy: Social media", RiskScore: float64(i % 100),
			Metadata:  map[string]any{"n": float64(i), "tags": []any{"a", "b"}, "nested": map[string]any{"x": "y"}},
			Timestamp: base.Add(time.Duration(i) * time.Minute).Add(123456 * time.Microsecond),
		}
		switch i % 10 {
		case 1:
			ev.Action, ev.Category, ev.EventType = models.EventActionAlerted, "dlp", models.EventTypePolicyViol
			ev.Metadata["detectors"] = []any{"credit_card"}
			ev.PolicyID = &policy
		case 2:
			ev.Action, ev.Category, ev.EventType, ev.Target = models.EventActionLogged, "application_control", models.EventTypeAppInstall, "NordVPN"
			ev.TargetDomain = ""
		case 3:
			ev.Category = "" // NULL/empty category, for NotCategories
		case 4:
			ev.Action, ev.Category = models.EventActionAlerted, "malware_detection"
		}
		if i%10 == 5 {
			ev.DedupeKey = "web|dedupe.example.com"
		}
		all = append(all, ev)
	}
	// One row in another org that no org-scoped query may ever see.
	all = append(all, &models.ActivityEvent{OrgID: other, EventType: models.EventTypeWebRequest, Action: models.EventActionBlocked, TargetDomain: "site1.example.com", Timestamp: base})

	for i := 0; i < len(all); i += 500 {
		end := i + 500
		if end > len(all) {
			end = len(all)
		}
		if err := st.InsertEvents(ctx, all[i:end]); err != nil {
			t.Fatalf("insert: %v", err)
		}
	}
	mine := all[:n]

	expect := func(name string, q EventQuery, keep func(*models.ActivityEvent) bool) {
		t.Helper()
		q.OrgID = org
		want := 0
		for _, ev := range mine {
			if keep(ev) {
				want++
			}
		}
		got, err := st.CountEvents(ctx, q)
		if err != nil {
			t.Fatalf("%s: count: %v", name, err)
		}
		if int(got) != want {
			t.Errorf("%s: count = %d, want %d", name, got, want)
		}
	}
	is := func(a models.EventAction) func(*models.ActivityEvent) bool {
		return func(e *models.ActivityEvent) bool { return e.Action == a }
	}
	expect("all", EventQuery{}, func(*models.ActivityEvent) bool { return true })
	expect("employee", EventQuery{EmployeeID: &emp2}, func(e *models.ActivityEvent) bool { return e.EmployeeID != nil && *e.EmployeeID == emp2 })
	expect("team scope", EventQuery{RestrictEmployees: true, EmployeeIn: []uuid.UUID{emp1}}, func(e *models.ActivityEvent) bool { return e.EmployeeID != nil && *e.EmployeeID == emp1 })
	expect("empty team scope", EventQuery{RestrictEmployees: true}, func(*models.ActivityEvent) bool { return false })
	expect("has employee", EventQuery{HasEmployee: true}, func(e *models.ActivityEvent) bool { return e.EmployeeID != nil })
	expect("device", EventQuery{DeviceID: &dev2}, func(e *models.ActivityEvent) bool { return *e.DeviceID == dev2 })
	expect("policy", EventQuery{PolicyID: &policy}, func(e *models.ActivityEvent) bool { return e.PolicyID != nil })
	expect("actions", EventQuery{Actions: []string{"alerted"}}, is(models.EventActionAlerted))
	expect("not actions", EventQuery{NotActions: []string{"blocked", "logged"}}, is(models.EventActionAlerted))
	expect("event types", EventQuery{EventTypes: []string{"app_install"}}, func(e *models.ActivityEvent) bool { return e.EventType == models.EventTypeAppInstall })
	expect("categories", EventQuery{Categories: []string{"dlp", "malware_detection"}}, func(e *models.ActivityEvent) bool {
		return e.Category == "dlp" || e.Category == "malware_detection"
	})
	expect("not categories", EventQuery{NotCategories: []string{"dlp", "application_control"}}, func(e *models.ActivityEvent) bool {
		return e.Category != "dlp" && e.Category != "application_control"
	})
	expect("any of", EventQuery{AnyOf: []EventClause{
		{EventTypes: []string{"app_install"}},
		{Categories: []string{"malware_detection"}},
	}}, func(e *models.ActivityEvent) bool {
		return e.EventType == models.EventTypeAppInstall || e.Category == "malware_detection"
	})
	since, before := base.Add(100*time.Minute), base.Add(200*time.Minute)
	expect("since/before", EventQuery{Since: since, Before: before}, func(e *models.ActivityEvent) bool {
		return !e.Timestamp.Before(since) && e.Timestamp.Before(before)
	})
	until := mine[300].Timestamp
	expect("until (inclusive)", EventQuery{Until: until}, func(e *models.ActivityEvent) bool { return !e.Timestamp.After(until) })
	expect("search, case-insensitive", EventQuery{Search: "SITE3.EXAMPLE", SearchFields: []string{"target_domain", "target"}}, func(e *models.ActivityEvent) bool {
		return strings.Contains(e.TargetDomain, "site3.example") || strings.Contains(e.Target, "site3.example")
	})
	expect("domain contains any", EventQuery{DomainContainsAny: []string{"site1.", "SITE2."}}, func(e *models.ActivityEvent) bool {
		return strings.Contains(e.TargetDomain, "site1.") || strings.Contains(e.TargetDomain, "site2.")
	})
	expect("target domain", EventQuery{TargetDomain: "site4.example.com"}, func(e *models.ActivityEvent) bool { return e.TargetDomain == "site4.example.com" })
	expect("has target domain", EventQuery{HasTargetDomain: true}, func(e *models.ActivityEvent) bool { return e.TargetDomain != "" })
	expect("dedupe key", EventQuery{DedupeKey: "web|dedupe.example.com"}, func(e *models.ActivityEvent) bool { return e.DedupeKey != "" })
	expect("ids", EventQuery{IDs: []uuid.UUID{mine[5].ID, mine[6].ID, all[n].ID}}, func(e *models.ActivityEvent) bool {
		return e.ID == mine[5].ID || e.ID == mine[6].ID
	})

	// Find: newest first, paging, full round trip of every field.
	page, err := st.FindEvents(ctx, EventQuery{OrgID: org, Offset: 1, Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 3 || page[0].ID != mine[n-2].ID || page[2].ID != mine[n-4].ID {
		t.Fatalf("paging/order wrong: %v", ids(page))
	}
	got := page[0]
	want := mine[n-2]
	if !near(got.Timestamp, want.Timestamp) || got.TargetDomain != want.TargetDomain || got.Action != want.Action ||
		got.EventType != want.EventType || got.RiskScore != want.RiskScore || *got.DeviceID != *want.DeviceID || got.OrgID != org {
		t.Fatalf("round trip mismatch:\n got  %+v\n want %+v", got, *want)
	}
	if got.Metadata["n"] != float64(n-2) {
		t.Errorf("metadata number = %#v (%T)", got.Metadata["n"], got.Metadata["n"])
	}
	if tags, ok := got.Metadata["tags"].([]any); !ok || len(tags) != 2 {
		t.Errorf("metadata array = %#v", got.Metadata["tags"])
	}
	if nested, ok := got.Metadata["nested"].(map[string]any); !ok || nested["x"] != "y" {
		t.Errorf("metadata object = %#v", got.Metadata["nested"])
	}
	asc, _ := st.FindEvents(ctx, EventQuery{OrgID: org, Ascending: true, Limit: 1})
	if len(asc) != 1 || asc[0].ID != mine[0].ID {
		t.Fatal("ascending order wrong")
	}
	proj, _ := st.FindEvents(ctx, EventQuery{OrgID: org, Fields: []string{"id", "target_domain", "timestamp"}, Limit: 1})
	if len(proj) != 1 || proj[0].TargetDomain == "" || proj[0].ID == uuid.Nil {
		t.Fatalf("projection lost requested fields: %+v", proj)
	}

	// Group.
	groups, err := st.GroupEvents(ctx, EventQuery{OrgID: org, HasTargetDomain: true}, "target_domain", 3)
	if err != nil {
		t.Fatal(err)
	}
	type agg struct {
		n     int64
		emps  map[uuid.UUID]bool
		first time.Time
		last  time.Time
	}
	ref := map[string]*agg{}
	for _, e := range mine {
		if e.TargetDomain == "" {
			continue
		}
		a := ref[e.TargetDomain]
		if a == nil {
			a = &agg{emps: map[uuid.UUID]bool{}, first: e.Timestamp}
			ref[e.TargetDomain] = a
		}
		a.n++
		if e.EmployeeID != nil {
			a.emps[*e.EmployeeID] = true
		}
		a.last = e.Timestamp
	}
	if len(groups) != 3 {
		t.Fatalf("group limit: got %d groups", len(groups))
	}
	for i, g := range groups {
		a := ref[g.Key]
		if a == nil || g.Count != a.n || g.Employees != int64(len(a.emps)) || g.First == nil || !near(*g.First, a.first) || !near(*g.Last, a.last) {
			t.Errorf("group %q = %+v, want n=%d emps=%d", g.Key, g, a.n, len(a.emps))
		}
		if i > 0 && g.Count > groups[i-1].Count {
			t.Error("groups not ordered by count")
		}
	}
	totals, err := st.GroupEvents(ctx, EventQuery{OrgID: org}, "", 0)
	if err != nil || len(totals) != 1 || totals[0].Count != n || totals[0].Employees != 2 {
		t.Fatalf("totals = %+v, %v", totals, err)
	}
	var riskSum float64
	for _, e := range mine {
		riskSum += e.RiskScore
	}
	if totals[0].RiskSum != riskSum {
		t.Errorf("risk sum = %v, want %v", totals[0].RiskSum, riskSum)
	}
	empty, err := st.GroupEvents(ctx, EventQuery{OrgID: uuid.New()}, "", 0)
	if err != nil || len(empty) != 1 || empty[0].Count != 0 {
		t.Fatalf("empty totals = %+v, %v", empty, err)
	}
	byAction, _ := st.GroupEvents(ctx, EventQuery{OrgID: org}, "action", 0)
	if len(byAction) != 3 {
		t.Errorf("by action = %+v", byAction)
	}

	// Each: every row once, in order, across batches.
	seen := map[uuid.UUID]bool{}
	var prev time.Time
	err = st.EachEvent(ctx, EventQuery{OrgID: org, Ascending: true, Fields: []string{"action", "metadata"}}, func(e *models.ActivityEvent) error {
		if seen[e.ID] {
			return fmt.Errorf("row %s visited twice", e.ID)
		}
		seen[e.ID] = true
		if e.Timestamp.Before(prev) {
			return fmt.Errorf("out of order")
		}
		prev = e.Timestamp
		return nil
	})
	if err != nil || len(seen) != n {
		t.Fatalf("each visited %d of %d: %v", len(seen), n, err)
	}
	count := 0
	st.EachEvent(ctx, EventQuery{OrgID: org, Limit: 2001}, func(*models.ActivityEvent) error { count++; return nil })
	if count != 2001 {
		t.Fatalf("each with limit visited %d", count)
	}

	// Update.
	target := *mine[10]
	target.Metadata["repeat_count"] = 4
	target.RiskScore = 99
	if err := st.UpdateEvent(ctx, &target, "metadata", "risk_score"); err != nil {
		t.Fatal(err)
	}
	back, _ := st.FindEvents(ctx, EventQuery{OrgID: org, IDs: []uuid.UUID{target.ID}})
	if len(back) != 1 || back[0].RiskScore != 99 || RepeatCount(back[0].Metadata) != 4 {
		t.Fatalf("update not applied: %+v", back)
	}

	// Duplicate IDs are refused (the spool relies on recognising that).
	if err := st.InsertEvents(ctx, []*models.ActivityEvent{mine[0]}); err == nil || !isDuplicateKey(err) {
		t.Fatalf("re-inserting a row should be a duplicate-key error, got %v", err)
	}

	// Delete.
	del, err := st.DeleteEvents(ctx, EventQuery{OrgID: org, Before: base.Add(60 * time.Minute)})
	if err != nil || del != 60 {
		t.Fatalf("deleted %d, want 60: %v", del, err)
	}
	if left, _ := st.CountEvents(ctx, EventQuery{OrgID: org}); left != n-60 {
		t.Fatalf("left %d", left)
	}
	if left, _ := st.CountEvents(ctx, EventQuery{OrgID: other}); left != 1 {
		t.Fatal("another org's row was touched")
	}

	// ── Sessions ──
	ended := base.Add(2 * time.Hour)
	s1 := &models.WorkSession{OrgID: org, EmployeeID: &emp1, DeviceID: &dev1, StartedAt: base, Hostname: "mac-1"}
	s2 := &models.WorkSession{OrgID: org, EmployeeID: &emp1, DeviceID: &dev1, StartedAt: base.Add(3 * time.Hour)}
	for _, s := range []*models.WorkSession{s1, s2} {
		if err := st.InsertSession(ctx, s); err != nil {
			t.Fatalf("insert session: %v", err)
		}
	}
	if _, err := st.UpdateSessions(ctx, SessionQuery{OrgID: org, IDs: []uuid.UUID{s1.ID}}, map[string]any{"ended_at": ended}); err != nil {
		t.Fatal(err)
	}
	open := true
	openOnes, err := st.FindSessions(ctx, SessionQuery{OrgID: org, DeviceID: &dev1, Open: &open, UpdatedSince: time.Now().Add(-time.Minute), OrderBy: "updated_at_desc"})
	if err != nil || len(openOnes) != 1 || openOnes[0].ID != s2.ID || openOnes[0].Project != "Default Project" {
		t.Fatalf("open sessions = %+v, %v", openOnes, err)
	}
	active, _ := st.FindSessions(ctx, SessionQuery{OrgID: org, EmployeeID: &emp1, StartedBefore: base.Add(4 * time.Hour), ActiveAfter: base.Add(150 * time.Minute)})
	if len(active) != 1 || active[0].ID != s2.ID {
		t.Fatalf("window overlap = %v", sessionIDs(active))
	}
	inRange, _ := st.FindSessions(ctx, SessionQuery{OrgID: org, StartedSince: base, StartedBefore: base.Add(time.Hour)})
	if len(inRange) != 1 || inRange[0].Hostname != "mac-1" || inRange[0].EndedAt == nil || !near(*inRange[0].EndedAt, ended) {
		t.Fatalf("started range = %+v", inRange)
	}

	// ── Screenshots ──
	var shots []*models.Screenshot
	for i := 0; i < 3; i++ {
		at := base.Add(time.Duration(10+i) * time.Minute)
		sh := &models.Screenshot{
			OrgID: org, EmployeeID: &emp1, DeviceID: &dev1, SessionID: &s1.ID, CapturedAt: at,
			IntervalStart: at.Add(-time.Minute), IntervalEnd: at, StorageKey: "ext:screenshots/" + uuid.NewString() + ".webp",
			ActivityPercent: 10 * (i + 1), ActiveSeconds: 30, IntervalSeconds: 60, State: "active",
			OpenApps: []string{"Slack", "Chrome"},
		}
		if err := st.InsertScreenshot(ctx, sh); err != nil {
			t.Fatalf("insert screenshot: %v", err)
		}
		shots = append(shots, sh)
	}
	found, err := st.FindScreenshots(ctx, ScreenshotQuery{OrgID: org, EmployeeID: &emp1, CapturedSince: base, CapturedBefore: base.Add(time.Hour)})
	if err != nil || len(found) != 3 || found[0].ID != shots[0].ID || len(found[2].OpenApps) != 2 || found[1].StorageKey != shots[1].StorageKey {
		t.Fatalf("screenshots = %+v, %v", found, err)
	}
	// The employee's own reason: only on their own screenshot, and it reads back.
	noteAt := base.Add(30 * time.Minute)
	if ok, err := st.SetScreenshotNote(ctx, org, emp1, shots[1].ID, "Personal call — lunch break", noteAt); err != nil || !ok {
		t.Fatalf("set own note: ok=%v err=%v", ok, err)
	}
	if ok, err := st.SetScreenshotNote(ctx, org, emp2, shots[1].ID, "not mine", noteAt); err != nil || ok {
		t.Fatalf("another employee must not be able to annotate it: ok=%v err=%v", ok, err)
	}
	if ok, _ := st.SetScreenshotNote(ctx, other, emp1, shots[1].ID, "wrong org", noteAt); ok {
		t.Fatal("a note must not cross organisations")
	}
	// Saving the same text again still counts as found (MySQL reports 0 rows changed).
	if ok, err := st.SetScreenshotNote(ctx, org, emp1, shots[1].ID, "Personal call — lunch break", noteAt); err != nil || !ok {
		t.Fatalf("repeat save: ok=%v err=%v", ok, err)
	}
	noted, _ := st.FindScreenshots(ctx, ScreenshotQuery{OrgID: org, IDs: []uuid.UUID{shots[1].ID}})
	if len(noted) != 1 || noted[0].EmployeeNote != "Personal call — lunch break" || noted[0].EmployeeNoteAt == nil || !near(*noted[0].EmployeeNoteAt, noteAt) {
		t.Fatalf("note did not round-trip: %+v", noted)
	}

	emps, _ := st.ScreenshotEmployees(ctx, org)
	if len(emps) != 1 || emps[0] != emp1 {
		t.Fatalf("screenshot employees = %v", emps)
	}
	roll, err := st.SessionRollup(ctx, s1.ID)
	if err != nil || roll.Count != 3 || roll.Active != 90 || roll.Tracked != 180 || roll.AvgActivity != 20 {
		t.Fatalf("rollup = %+v, %v", roll, err)
	}
	if _, err := st.UpdateSessions(ctx, SessionQuery{IDs: []uuid.UUID{s1.ID}}, map[string]any{
		"screenshot_count": roll.Count, "active_seconds": roll.Active, "tracked_seconds": roll.Tracked, "avg_activity": roll.AvgActivity,
	}); err != nil {
		t.Fatal(err)
	}
	if n, _ := st.DeleteScreenshots(ctx, ScreenshotQuery{OrgID: org, IDs: []uuid.UUID{shots[0].ID}}); n != 1 {
		t.Fatalf("deleted %d screenshots", n)
	}
	if n, _ := st.DeleteScreenshots(ctx, ScreenshotQuery{OrgID: org, SessionID: &s1.ID}); n != 2 {
		t.Fatalf("deleted %d screenshots by session", n)
	}
	// Retention: a session that ended before the cutoff with no images goes;
	// s1 still records 3 screenshots in its rollup, so it stays.
	if n, _ := st.DeleteSessions(ctx, SessionQuery{OrgID: org, EndedBefore: base.Add(5 * time.Hour), NoScreenshots: true}); n != 0 {
		t.Fatalf("retention deleted %d sessions, want 0", n)
	}
	if n, _ := st.DeleteSessions(ctx, SessionQuery{OrgID: org}); n != 2 {
		t.Fatalf("deleted %d sessions", n)
	}

	// Clean up.
	st.DeleteEvents(ctx, EventQuery{OrgID: org})
	st.DeleteEvents(ctx, EventQuery{OrgID: other})
}

func ids(evs []models.ActivityEvent) []string {
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = e.ID.String()[:8]
	}
	sort.Strings(out)
	return out
}

func sessionIDs(s []models.WorkSession) []string {
	out := make([]string, len(s))
	for i, x := range s {
		out[i] = x.ID.String()[:8]
	}
	return out
}

// upgradeFromOlderSchema simulates a company database created before the
// employee-note columns existed: drop them, reconnect-time ensureSchema must
// add them back, and writing a note must work afterwards.
func upgradeFromOlderSchema(t *testing.T, st tenantStore) {
	t.Helper()
	ctx := context.Background()
	var ss *sqlStore
	switch v := st.(type) {
	case *sqlStore:
		ss = v
	case *pgTenant:
		ss = v.sqlStore
	default:
		return // MongoDB has no columns to add
	}
	drops := map[string][]string{
		"postgres":  {"ALTER TABLE aavishield_screenshots DROP COLUMN IF EXISTS employee_note", "ALTER TABLE aavishield_screenshots DROP COLUMN IF EXISTS employee_note_at"},
		"mysql":     {"ALTER TABLE aavishield_screenshots DROP COLUMN employee_note", "ALTER TABLE aavishield_screenshots DROP COLUMN employee_note_at"},
		"sqlserver": {"ALTER TABLE aavishield_screenshots DROP COLUMN employee_note", "ALTER TABLE aavishield_screenshots DROP COLUMN employee_note_at"},
	}[ss.dialect]
	for _, q := range drops {
		if err := ss.db.Exec(q).Error; err != nil {
			t.Fatalf("simulate old schema: %v", err)
		}
	}
	if err := st.ensureSchema(ctx); err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	if err := st.ensureSchema(ctx); err != nil {
		t.Fatalf("upgrade must be idempotent: %v", err)
	}
	org, emp := uuid.New(), uuid.New()
	shot := &models.Screenshot{OrgID: org, EmployeeID: &emp, CapturedAt: time.Now(), StorageKey: "k"}
	if err := st.InsertScreenshot(ctx, shot); err != nil {
		t.Fatal(err)
	}
	if ok, err := st.SetScreenshotNote(ctx, org, emp, shot.ID, "after upgrade", time.Now()); err != nil || !ok {
		t.Fatalf("note after upgrade: ok=%v err=%v", ok, err)
	}
	st.DeleteScreenshots(ctx, ScreenshotQuery{OrgID: org})
}
