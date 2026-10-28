package handlers

// Hash lookups and chunked scan jobs against a real Postgres, through the
// agent's own bearer auth. Opt-in, like the other integration tests: set
// SCANJOB_IT_DSN to a THROWAWAY database (its public schema is wiped).

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestDownloadScanIntegration(t *testing.T) {
	dsn := os.Getenv("SCANJOB_IT_DSN")
	if dsn == "" {
		t.Skip("SCANJOB_IT_DSN not set")
	}
	gin.SetMode(gin.TestMode)
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
	must(db.AutoMigrate(&models.Organization{}, &models.User{}, &models.Employee{}, &models.ActivityEvent{},
		&models.AccessRequest{}, &models.AgentToken{}, &models.FileVerdict{}, &models.OrgDataResidency{}))
	dataplane.Init(db, nil)

	org := models.Organization{Name: "Delphic", Slug: "delphic-" + uuid.NewString()[:8]}
	must(db.Create(&org).Error)
	emp := models.Employee{OrgID: org.ID, Email: "riya@delphic.test", FirstName: "Riya", LastName: "Patel"}
	must(db.Create(&emp).Error)
	device, other := uuid.New(), uuid.New()
	must(db.Create(&models.AgentToken{DeviceID: device, OrgID: org.ID, EmployeeID: &emp.ID, TokenHash: agentKeyHash("k1")}).Error)
	must(db.Create(&models.AgentToken{DeviceID: other, OrgID: org.ID, TokenHash: agentKeyHash("k2")}).Error)

	h := NewAgentHandler(db, nil, nil, nil)
	call := func(fn gin.HandlerFunc, as uuid.UUID, key, method, target string, body []byte, id string) (int, map[string]any) {
		t.Helper()
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(method, target, bytes.NewReader(body))
		c.Request.Header.Set("Authorization", "Bearer "+as.String()+":"+key)
		if id != "" {
			c.Params = gin.Params{{Key: "id", Value: id}}
		}
		fn(c)
		var out map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	me := func(fn gin.HandlerFunc, method, target string, body []byte, id string) (int, map[string]any) {
		return call(fn, device, "k1", method, target, body, id)
	}

	// ── Hash reputation ───────────────────────────────────────────────────
	bad := strings.Repeat("ab", 32)
	if code, out := me(h.ScanHash, "POST", "/?sha256="+bad+"&filename=x.dmg", nil, ""); code != 200 || out["known"] != false {
		t.Fatalf("an unseen hash must be unknown: %d %v", code, out)
	}
	must(db.Create(&models.FileVerdict{SHA256: bad, Action: "block", Band: "block", Verdict: "malware", Score: 100, Signature: "Eicar-Test", ScannedAt: time.Now().Add(-365 * 24 * time.Hour)}).Error)
	code, out := me(h.ScanHash, "POST", "/?sha256="+strings.ToUpper(bad)+"&filename=x.dmg&destination=evil.test", nil, "")
	if code != 200 || out["known"] != true || out["action"] != "block" {
		t.Fatalf("a known-malicious hash must block however old the verdict: %d %v", code, out)
	}
	var incidents int64
	db.Model(&models.ActivityEvent{}).Where("org_id = ? AND action = ?", org.ID, models.EventActionBlocked).Count(&incidents)
	if incidents != 1 {
		t.Fatalf("a cached block is still this employee's incident, got %d events", incidents)
	}

	stale := strings.Repeat("cd", 32)
	must(db.Create(&models.FileVerdict{SHA256: stale, Action: "allow", ScannedAt: time.Now().Add(-8 * 24 * time.Hour)}).Error)
	if _, out := me(h.ScanHash, "POST", "/?sha256="+stale, nil, ""); out["known"] != false {
		t.Fatalf("a week-old clean verdict must be rescanned: %v", out)
	}
	if code, _ := me(h.ScanHash, "POST", "/?sha256=nothex", nil, ""); code != 400 {
		t.Fatalf("a malformed hash must be refused, got %d", code)
	}
	if _, out := me(h.ScanHash, "POST", "/?sha256="+stale+"&unscanned=too_large&filename=huge.iso", nil, ""); out["action"] != "allow" {
		t.Fatalf("an unscannable download is allowed and logged: %v", out)
	}
	var unscanned int64
	db.Model(&models.ActivityEvent{}).Where("org_id = ? AND policy_name = ?", org.ID, "Download not scanned").Count(&unscanned)
	if unscanned != 1 {
		t.Fatalf("the unscanned download must be visible to admins, got %d", unscanned)
	}

	// ── Chunked scan job ──────────────────────────────────────────────────
	if code, _ := me(h.CreateScanJob, "POST", "/?size=99999999999", nil, ""); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("a file over the scan limit must be refused up front, got %d", code)
	}
	code, out = me(h.CreateScanJob, "POST", "/?size=10&filename=setup.exe", nil, "")
	if code != http.StatusCreated {
		t.Fatalf("create job: %d %v", code, out)
	}
	id := out["id"].(string)

	if code, _ := call(h.GetScanJob, other, "k2", "GET", "/", nil, id); code != 404 {
		t.Fatalf("another device must not see this job, got %d", code)
	}
	if code, _ := me(h.CompleteScanJob, "POST", "/", nil, id); code != http.StatusConflict {
		t.Fatalf("an incomplete upload must not be scanned, got %d", code)
	}
	if _, out := me(h.UploadScanJobPart, "PUT", "/?offset=0", []byte("hello"), id); out["received"] != float64(5) {
		t.Fatalf("first part: %v", out)
	}
	if _, out := me(h.UploadScanJobPart, "PUT", "/?offset=0", []byte("hello"), id); out["received"] != float64(5) {
		t.Fatalf("a repeated part must not be written twice: %v", out)
	}
	if code, out := me(h.UploadScanJobPart, "PUT", "/?offset=7", []byte("xyz"), id); code != http.StatusConflict || out["received"] != float64(5) {
		t.Fatalf("a gap must be refused with the real offset: %d %v", code, out)
	}
	if _, out := me(h.UploadScanJobPart, "PUT", "/?offset=5", []byte("world"), id); out["received"] != float64(10) {
		t.Fatalf("second part: %v", out)
	}
	if code, _ := me(h.CompleteScanJob, "POST", "/", nil, id); code != http.StatusAccepted {
		t.Fatalf("complete: %d", code)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		_, out = me(h.GetScanJob, "GET", "/", nil, id)
		if out["state"] == "done" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("scan never finished: %v", out)
		}
		time.Sleep(50 * time.Millisecond)
	}
	if out["action"] != "allow" {
		t.Fatalf("harmless bytes must be allowed: %v", out)
	}
}
