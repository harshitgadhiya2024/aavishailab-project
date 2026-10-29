package handlers

import (
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm/clause"

	"github.com/aavishield/admin-api/internal/models"
)

// Download scanning for files of any size, the way inline security gateways
// do it — reputation by hash first, the bytes only when the hash is unknown.
//
// ScanFile (agents.go) takes the whole file in one request and answers in
// the same request. That cannot work for a real installer: api.aavishield.com
// is behind Cloudflare, which refuses request bodies over ~100 MB and gives
// up on an origin that takes more than ~100 s to answer. So the agent:
//
//  1. asks ScanHash whether these exact bytes already have a verdict — any
//     device, any org, since a hash says nothing about who downloaded it.
//     Most downloads are popular installers, so most stop here, with no
//     upload at all;
//  2. otherwise opens a scan job, uploads the file in parts small enough for
//     Cloudflare, marks it complete, and polls for the verdict while the
//     scan runs here in the background.
//
// Every scan result is remembered by the hash malware-service computed from
// the bytes (rememberFileVerdict), never by a hash the agent claimed.
//
// Jobs live in this process's memory with their spool on local disk, which
// assumes the single admin-api instance production runs today; a job that
// is lost to a restart reads as "not found" and the agent fails open.

const (
	// clamd's own StreamMaxLength in production is 4000M.
	maxScanJobBytes = 4000 << 20
	// Comfortably under Cloudflare's ~100 MB request body limit.
	scanJobPartBytes = 32 << 20
	maxJobsPerDevice = 4
	// An upload that stops arriving, or a verdict nobody collects.
	scanJobIdleTTL = 30 * time.Minute
	scanJobTimeout = 15 * time.Minute
	// A clean verdict can go stale as signatures update; a malicious one
	// does not become safe.
	cleanVerdictTTL = 7 * 24 * time.Hour
)

var sha256Hex = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (h *AgentHandler) rememberFileVerdict(v fileVerdict) {
	if !v.scanned || v.sha256 == "" {
		return
	}
	row := models.FileVerdict{
		SHA256: strings.ToLower(v.sha256), Action: v.action, Band: v.band, Verdict: v.verdict,
		Score: v.score, Signature: v.signature, Reason: fileVerdictReason(v), ScannedAt: time.Now(),
	}
	if err := h.db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&row).Error; err != nil {
		log.Printf("file verdict not cached: %v", err)
	}
}

func (h *AgentHandler) cachedFileVerdict(sha string) (fileVerdict, bool) {
	var row models.FileVerdict
	if err := h.db.Where("sha256 = ?", sha).First(&row).Error; err != nil {
		return fileVerdict{}, false
	}
	if row.Action != "block" && time.Since(row.ScannedAt) > cleanVerdictTTL {
		return fileVerdict{}, false
	}
	v := fileVerdict{
		scanned: true, infected: row.Action == "block", score: row.Score, band: row.Band, action: row.Action,
		verdict: row.Verdict, signature: row.Signature, sha256: row.SHA256,
	}
	if row.Reason != "" && row.Signature == "" {
		v.reasons = []string{row.Reason}
	}
	return v, true
}

// ScanHash handles POST /internal/agent/scan-hash?sha256=…&filename=…&destination=…
//
// {"known": false} means the agent has to upload the file. With
// &unscanned=<why>, the agent is reporting a download it could not submit
// (too large to scan), which is logged for the admins and allowed — the
// same fail-open every other scan path uses, made visible.
func (h *AgentHandler) ScanHash(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	sha := strings.ToLower(c.Query("sha256"))
	filename := c.Query("filename")
	destination := c.Query("destination")
	if !sha256Hex.MatchString(sha) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sha256 must be 64 hex characters"})
		return
	}

	if v, ok := h.cachedFileVerdict(sha); ok {
		v = h.settleFileVerdict(c.Request.Context(), deviceID, orgID, empID, filename, destination, v)
		c.JSON(http.StatusOK, gin.H{"known": true, "action": v.action, "reason": fileVerdictReason(v)})
		return
	}

	// &detected=<engine>: the device's own antivirus refused the file
	// before it could be uploaded (Windows Security quarantines the
	// agent's temporary copy of a download it recognises). That is a
	// verdict, so it is blocked and logged like one — but only for this
	// device. It is not cached as the hash's reputation: one device's
	// claim must not be able to block a file for every company.
	if engine := c.Query("detected"); engine != "" {
		v := fileVerdict{
			scanned: true, infected: true, score: 100, band: "block", action: "block", verdict: "malware",
			signature: "Blocked by " + sanitizeEngine(engine), sha256: sha,
		}
		v = h.settleFileVerdict(c.Request.Context(), deviceID, orgID, empID, filename, destination, v)
		c.JSON(http.StatusOK, gin.H{"known": true, "action": v.action, "reason": fileVerdictReason(v)})
		return
	}

	if why := c.Query("unscanned"); why != "" {
		event := models.ActivityEvent{
			OrgID: orgID, EmployeeID: empID, DeviceID: &deviceID,
			EventType: models.EventTypeFileOp, Action: models.EventActionAlerted,
			Target: filename, TargetDomain: destination, Operation: OpFileDownload,
			Category: "malware_detection", PolicyName: "Download not scanned",
			Metadata:  map[string]any{"sha256": sha, "unscanned": why, "size": c.Query("size")},
			Timestamp: time.Now(),
		}
		if err := recordAndBroadcast(c.Request.Context(), h.db, h.hub, &event); err != nil {
			log.Printf("activity event not stored: %v", err)
		}
		c.JSON(http.StatusOK, gin.H{"known": true, "action": "allow"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"known": false})
}

type scanJob struct {
	mu          sync.Mutex
	deviceID    uuid.UUID
	orgID       uuid.UUID
	empID       *uuid.UUID
	filename    string
	destination string
	contentType string
	size        int64
	spool       *os.File
	received    int64
	state       string // uploading | scanning | done
	verdict     fileVerdict
	touched     time.Time
}

var scanJobs = struct {
	sync.Mutex
	m map[uuid.UUID]*scanJob
}{m: map[uuid.UUID]*scanJob{}}

// sweepScanJobs drops jobs nobody has touched for scanJobIdleTTL. Run on
// every create rather than on a timer: jobs only accumulate while new
// ones are being made.
func sweepScanJobs() {
	scanJobs.Lock()
	defer scanJobs.Unlock()
	for id, j := range scanJobs.m {
		j.mu.Lock()
		stale := j.state != "scanning" && time.Since(j.touched) > scanJobIdleTTL
		if stale && j.spool != nil {
			j.spool.Close()
			j.spool = nil
		}
		j.mu.Unlock()
		if stale {
			delete(scanJobs.m, id)
		}
	}
}

// jobFor returns the job, only to the device that created it.
func jobFor(c *gin.Context, deviceID uuid.UUID) *scanJob {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "scan job not found"})
		return nil
	}
	scanJobs.Lock()
	j := scanJobs.m[id]
	scanJobs.Unlock()
	if j == nil || j.deviceID != deviceID {
		c.JSON(http.StatusNotFound, gin.H{"error": "scan job not found"})
		return nil
	}
	return j
}

// CreateScanJob handles POST /internal/agent/scan-jobs?size=…&filename=…&destination=…&content_type=…
func (h *AgentHandler) CreateScanJob(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	size, err := strconv.ParseInt(c.Query("size"), 10, 64)
	if err != nil || size <= 0 || size > maxScanJobBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "size must be between 1 byte and the scan limit", "max_bytes": maxScanJobBytes})
		return
	}

	sweepScanJobs()
	scanJobs.Lock()
	open := 0
	for _, j := range scanJobs.m {
		if j.deviceID == deviceID {
			open++
		}
	}
	scanJobs.Unlock()
	if open >= maxJobsPerDevice {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many scans in progress for this device"})
		return
	}

	spool, err := os.CreateTemp("", "aavishield-scanjob-*")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not prepare scan"})
		return
	}
	// Unlinked at once, as spoolBody does: the descriptor keeps the bytes
	// reachable and nothing is left on disk once the job is gone.
	_ = os.Remove(spool.Name())

	id := uuid.New()
	scanJobs.Lock()
	scanJobs.m[id] = &scanJob{
		deviceID: deviceID, orgID: orgID, empID: empID,
		filename: c.Query("filename"), destination: c.Query("destination"), contentType: c.Query("content_type"),
		size: size, spool: spool, state: "uploading", touched: time.Now(),
	}
	scanJobs.Unlock()
	c.JSON(http.StatusCreated, gin.H{"id": id, "part_bytes": scanJobPartBytes})
}

// UploadScanJobPart handles PUT /internal/agent/scan-jobs/:id/parts?offset=N
//
// Parts must arrive in order. A part repeated after a lost response is
// acknowledged without being written twice; a gap is refused with the
// offset the job is actually at, so the agent can resume from there.
func (h *AgentHandler) UploadScanJobPart(c *gin.Context) {
	deviceID, _, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	j := jobFor(c, deviceID)
	if j == nil {
		return
	}
	offset, err := strconv.ParseInt(c.Query("offset"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "offset is required"})
		return
	}

	j.mu.Lock()
	defer j.mu.Unlock()
	j.touched = time.Now()
	if j.state != "uploading" || j.spool == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "scan job is not accepting parts", "state": j.state})
		return
	}
	body := http.MaxBytesReader(c.Writer, c.Request.Body, scanJobPartBytes)
	if offset < j.received {
		_, _ = io.Copy(io.Discard, body)
		c.JSON(http.StatusOK, gin.H{"received": j.received})
		return
	}
	if offset > j.received {
		c.JSON(http.StatusConflict, gin.H{"error": "parts must arrive in order", "received": j.received})
		return
	}
	n, err := io.Copy(j.spool, io.LimitReader(body, j.size-j.received+1))
	j.received += n
	if err != nil || j.received > j.size {
		// The spool now holds a partial or oversized part; start the job over.
		j.spool.Close()
		j.spool = nil
		j.state = "done"
		j.verdict = fileVerdict{action: "allow", band: "allow", verdict: "clean"}
		c.JSON(http.StatusBadRequest, gin.H{"error": "part could not be stored"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"received": j.received})
}

// CompleteScanJob handles POST /internal/agent/scan-jobs/:id/complete and
// starts the scan in the background; the agent polls GetScanJob.
func (h *AgentHandler) CompleteScanJob(c *gin.Context) {
	deviceID, _, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	j := jobFor(c, deviceID)
	if j == nil {
		return
	}

	j.mu.Lock()
	defer j.mu.Unlock()
	j.touched = time.Now()
	if j.state != "uploading" {
		c.JSON(http.StatusAccepted, gin.H{"state": j.state})
		return
	}
	if j.received != j.size {
		c.JSON(http.StatusConflict, gin.H{"error": "upload is incomplete", "received": j.received, "size": j.size})
		return
	}
	j.state = "scanning"
	go h.runScanJob(j)
	c.JSON(http.StatusAccepted, gin.H{"state": j.state})
}

func (h *AgentHandler) runScanJob(j *scanJob) {
	ctx, cancel := context.WithTimeout(context.Background(), scanJobTimeout)
	defer cancel()

	// Read without holding the lock: nothing writes to a job in "scanning".
	v := scanFileStream(ctx, j.orgID.String(), j.filename, j.contentType, j.destination, j.spool, j.size)
	h.rememberFileVerdict(v)
	v = h.settleFileVerdict(ctx, j.deviceID, j.orgID, j.empID, j.filename, j.destination, v)

	j.mu.Lock()
	j.spool.Close()
	j.spool = nil
	j.verdict = v
	j.state = "done"
	j.touched = time.Now()
	j.mu.Unlock()
}

// GetScanJob handles GET /internal/agent/scan-jobs/:id
func (h *AgentHandler) GetScanJob(c *gin.Context) {
	deviceID, _, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	j := jobFor(c, deviceID)
	if j == nil {
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	j.touched = time.Now()
	if j.state != "done" {
		c.JSON(http.StatusOK, gin.H{"state": j.state, "received": j.received})
		return
	}
	c.JSON(http.StatusOK, gin.H{"state": j.state, "scanned": j.verdict.scanned, "action": j.verdict.action, "reason": fileVerdictReason(j.verdict)})
}

// sanitizeEngine keeps an agent-reported antivirus name printable and short.
func sanitizeEngine(s string) string {
	var b strings.Builder
	for _, r := range s {
		if b.Len() >= 40 {
			break
		}
		if r == ' ' || r == '-' || r == '.' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "device antivirus"
	}
	return b.String()
}
