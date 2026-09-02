package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/casbclient"
	"github.com/aavishield/admin-api/internal/dlp"
	"github.com/aavishield/admin-api/internal/dlpclient"
	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/malwareclient"
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/mitm"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/notifier"
	"github.com/aavishield/admin-api/internal/policysig"
	"github.com/aavishield/admin-api/internal/postureclient"
	"github.com/aavishield/admin-api/internal/riskengine"
	"github.com/aavishield/admin-api/internal/schedule"
	"github.com/aavishield/admin-api/internal/shadowitclient"
	"github.com/aavishield/admin-api/internal/threatintelclient"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// swgEndpoint returns the SWG proxy host/port that agents should connect to.
// Employees install from other devices, so this must be a routable address
// (LAN IP / hostname), never "localhost" — set SWG_PUBLIC_HOST accordingly.
func swgEndpoint() (string, int) {
	host := os.Getenv("SWG_PUBLIC_HOST")
	if host == "" {
		host = "localhost"
	}
	port := 6080
	if p := os.Getenv("SWG_PUBLIC_PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			port = n
		}
	}
	return host, port
}

type AgentHandler struct {
	db     *gorm.DB
	hub    *WebSocketHub
	rdb    *redis.Client
	signer *policysig.Signer
}

func NewAgentHandler(db *gorm.DB, hub *WebSocketHub, rdb *redis.Client, signer *policysig.Signer) *AgentHandler {
	return &AgentHandler{db: db, hub: hub, rdb: rdb, signer: signer}
}

// ─── Redis-backed hot-path caching ────────────────────────────────────────────
//
// authAgent and GetRules are called on every single agent poll (heartbeat/60s,
// rules/10s, activity/5s all authenticate through authAgent). Before this,
// every one of those calls did a SELECT + an unconditional UPDATE on
// agent_tokens, and GetRules recomputed the org's entire rule set from 4-6
// queries every time — with Redis already deployed and doing nothing. A load
// test at 1,000 simulated devices measured GetRules at ~940ms p50 / ~1.8s p95
// before this change (scripts/loadtest/results/baseline-1k-pre-phase1.txt).
//
// Redis is treated as best-effort throughout: any error (including Redis
// being down) falls through to the original DB path, matching the fail-open
// design already used everywhere else in this handler set. A cache outage
// degrades performance, never correctness or availability.

const (
	agentTokenCacheTTL    = 60 * time.Second // matches the real heartbeat interval
	agentLastSeenDebounce = 60 * time.Second
	rulesCacheTTL         = 15 * time.Second // > 10s poll interval, short enough that a
	// policy change is visible to a device within one missed poll at worst.
)

type cachedAgentToken struct {
	OrgID      uuid.UUID  `json:"org_id"`
	EmployeeID *uuid.UUID `json:"employee_id"`
	Revoked    bool       `json:"revoked"`
}

func agentTokenCacheKey(deviceID, keyHash string) string {
	return "agent:tok:" + deviceID + ":" + keyHash
}

func agentLastSeenKey(deviceID string) string {
	return "agent:seen:" + deviceID
}

func rulesCacheKey(orgID uuid.UUID, empID *uuid.UUID) string {
	if empID != nil {
		return fmt.Sprintf("agent:rules:%s:%s", orgID, *empID)
	}
	return fmt.Sprintf("agent:rules:%s:none", orgID)
}

// ─── Enrollment Token (company dashboard) ────────────────────────────────────

// GenerateEnrollmentToken handles POST /employees/:id/enrollment-token
// Called by company admins to get a token they give to the employee for device setup.
func (h *AgentHandler) GenerateEnrollmentToken(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	empID := c.Param("id")
	userID, _ := c.Get(middleware.ContextKeyUserID)
	uid, _ := userID.(uuid.UUID)

	var emp models.Employee
	if err := h.db.Where("id = ? AND org_id = ?", empID, orgID).First(&emp).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Employee not found"})
		return
	}

	var req struct {
		Label string `json:"label"`
	}
	c.ShouldBindJSON(&req)

	raw := make([]byte, 24)
	rand.Read(raw)
	token := "dse_" + hex.EncodeToString(raw)

	orgUUID, _ := uuid.Parse(orgID)
	empUUID := emp.ID

	enrollToken := models.EnrollmentToken{
		OrgID:      orgUUID,
		EmployeeID: &empUUID,
		Token:      token,
		Label:      req.Label,
		ExpiresAt:  time.Now().Add(24 * time.Hour),
		CreatedBy:  &uid,
	}
	if err := h.db.Create(&enrollToken).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create enrollment token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":       token,
		"expires_at":  enrollToken.ExpiresAt,
		"employee":    emp.FullName(),
		"employee_id": emp.ID,
	})
}

// ListEnrollmentTokens handles GET /employees/:id/enrollment-tokens
func (h *AgentHandler) ListEnrollmentTokens(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	empID := c.Param("id")
	orgUUID, _ := uuid.Parse(orgID)
	empUUID, _ := uuid.Parse(empID)

	var tokens []models.EnrollmentToken
	h.db.Where("org_id = ? AND employee_id = ?", orgUUID, empUUID).
		Order("created_at DESC").Find(&tokens)

	c.JSON(http.StatusOK, tokens)
}

// ─── Agent Enrollment (internal — called by install script) ──────────────────

// Enroll handles POST /internal/agent/enroll
// The install script calls this with the enrollment token to register the device.
func (h *AgentHandler) Enroll(c *gin.Context) {
	var req struct {
		Token        string `json:"token" binding:"required"`
		Hostname     string `json:"hostname" binding:"required"`
		OSType       string `json:"os_type"`
		OSVersion    string `json:"os_version"`
		MACAddress   string `json:"mac_address"`
		AgentVersion string `json:"agent_version"`
		IPAddress    string `json:"ip_address"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var enrollToken models.EnrollmentToken
	if err := h.db.Where("token = ? AND used_at IS NULL AND expires_at > ?", req.Token, time.Now()).
		First(&enrollToken).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired enrollment token"})
		return
	}

	ipAddr := req.IPAddress
	if ipAddr == "" {
		ipAddr = c.ClientIP()
	}

	// Re-enrolling the same physical machine (re-run installer, reinstall,
	// fresh enrollment token) must reuse its existing Device row instead of
	// inserting a new one, otherwise the same laptop shows up twice in the
	// dashboard/portal. Match by MAC address when available (most reliable
	// machine fingerprint); fall back to hostname+employee when the agent
	// didn't report one.
	now := time.Now()
	var device models.Device
	lookup := h.db.Where("org_id = ?", enrollToken.OrgID)
	if req.MACAddress != "" {
		lookup = lookup.Where("mac_address = ?", req.MACAddress)
	} else {
		lookup = lookup.Where("mac_address = '' AND hostname = ? AND employee_id = ?", req.Hostname, enrollToken.EmployeeID)
	}
	isNewDevice := lookup.First(&device).Error != nil

	// Re-enrolling is allowed. Protection is now accountability rather than
	// prevention: an employee may disconnect and reconnect their own machine,
	// and each transition is written to activity_events and emailed to the
	// company's admins (see device_lifecycle.go). Blocking re-enrollment would
	// make disconnect a one-way door with no way back.
	device.OrgID = enrollToken.OrgID
	device.EmployeeID = enrollToken.EmployeeID
	device.Hostname = req.Hostname
	device.OSType = req.OSType
	device.OSVersion = req.OSVersion
	device.AgentVersion = req.AgentVersion
	device.MACAddress = req.MACAddress
	device.IPAddress = ipAddr
	device.Status = "online"
	device.LastSeenAt = &now

	if isNewDevice {
		device.EnrolledAt = now
		if err := h.db.Create(&device).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create device"})
			return
		}
	} else {
		if err := h.db.Save(&device).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update device"})
			return
		}
		// Invalidate the previous install's agent key — it's being replaced.
		h.db.Where("device_id = ?", device.ID).Delete(&models.AgentToken{})
	}

	rawKey := make([]byte, 32)
	rand.Read(rawKey)
	agentKey := "dsa_" + hex.EncodeToString(rawKey)
	keyHash := agentKeyHash(agentKey)

	agentToken := models.AgentToken{
		DeviceID:   device.ID,
		OrgID:      enrollToken.OrgID,
		EmployeeID: enrollToken.EmployeeID,
		TokenHash:  keyHash,
	}
	if err := h.db.Create(&agentToken).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create agent token"})
		return
	}

	// Mark enrollment token as used (single-use)
	h.db.Model(&enrollToken).Update("used_at", now)

	// Increment employee device count — only for a genuinely new device, not
	// a re-enrollment of one that already existed.
	if isNewDevice && enrollToken.EmployeeID != nil {
		h.db.Model(&models.Employee{}).
			Where("id = ?", *enrollToken.EmployeeID).
			UpdateColumn("device_count", gorm.Expr("device_count + 1"))
	}

	// Broadcast new device event to company dashboard
	h.hub.BroadcastToOrg(enrollToken.OrgID.String(), "device_enrolled", device)

	// A device joining the estate is worth an email — an enrolment nobody
	// authorised is otherwise invisible until someone opens the dashboard.
	if isNewDevice {
		if admins := notifier.AdminEmails(h.db, enrollToken.OrgID.String()); len(admins) > 0 {
			var org models.Organization
			orgName := "your organization"
			if err := h.db.First(&org, "id = ?", enrollToken.OrgID).Error; err == nil {
				orgName = org.Name
				if !org.WantsNotification("device_enrolment") {
					return
				}
			}
			empName := "Unassigned"
			if enrollToken.EmployeeID != nil {
				var emp models.Employee
				if err := h.db.First(&emp, "id = ?", *enrollToken.EmployeeID).Error; err == nil {
					empName = emp.FullName()
				}
			}
			mailer.DeviceEnrolled(admins, orgName, device.Hostname, empName, device.OSType)
		}
	}

	swgHost, swgPort := swgEndpoint()
	c.JSON(http.StatusOK, gin.H{
		"device_id":   device.ID,
		"agent_key":   agentKey,
		"org_id":      device.OrgID,
		"employee_id": enrollToken.EmployeeID,
		"swg_host":    swgHost,
		"swg_port":    swgPort,
	})
}

// ─── Agent Lifecycle (requires agent auth) ────────────────────────────────────

// Heartbeat handles POST /internal/agent/heartbeat
// Agent calls this every 60 s to report it's still running.
func (h *AgentHandler) Heartbeat(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	var req struct {
		Status     string                 `json:"status"`
		IPAddress  string                 `json:"ip_address"`
		MACAddress string                 `json:"mac_address"`
		ProxyPort  int                    `json:"proxy_port"`
		OSType     string                 `json:"os_type"`
		OSVersion  string                 `json:"os_version"`
		AgentVer   string                 `json:"agent_version"`
		Posture    *postureclient.Signals `json:"posture"`
	}
	c.ShouldBindJSON(&req)

	status := req.Status
	if status == "" {
		status = "online"
	}

	now := time.Now()
	updates := map[string]any{
		"status":       status,
		"last_seen_at": now,
	}
	if req.IPAddress != "" {
		updates["ip_address"] = req.IPAddress
	}
	if strings.TrimSpace(req.MACAddress) != "" {
		updates["mac_address"] = strings.TrimSpace(req.MACAddress)
	}
	// Older agents don't send this; only overwrite when they do, so their row
	// keeps the version recorded at enrolment rather than being blanked.
	if v := strings.TrimSpace(req.AgentVer); v != "" {
		updates["agent_version"] = v
	}

	// Posture + GeoIP enrichment via posture-service (best-effort — a heartbeat
	// must never fail because the enrichment service is briefly unavailable).
	var postureResult *postureclient.PostureResult
	meta := map[string]any{}
	if postureclient.Enabled() {
		if req.IPAddress != "" {
			if geo, err := postureclient.GeoIP(c.Request.Context(), orgID.String(), req.IPAddress); err == nil {
				if geo.IsPrivate {
					meta["geo_country"] = "private-network"
				} else if geo.CountryCode != "" {
					meta["geo_country"] = geo.Country
					meta["geo_country_code"] = geo.CountryCode
				}
			}
		}
		if req.Posture != nil {
			if req.OSType != "" && req.Posture.OSType == "" {
				req.Posture.OSType = req.OSType
			}
			if pr, err := postureclient.Evaluate(c.Request.Context(), orgID.String(), deviceID.String(), *req.Posture); err == nil {
				postureResult = pr
				updates["posture_score"] = pr.Score
				meta["posture_status"] = pr.Status
				meta["posture_failed"] = pr.Failed
			}
		}
	}

	if len(meta) > 0 {
		// Merge into existing device metadata rather than clobbering it.
		var dev models.Device
		if err := h.db.Select("id", "metadata").Where("id = ? AND org_id = ?", deviceID, orgID).First(&dev).Error; err == nil {
			if dev.Metadata == nil {
				dev.Metadata = map[string]any{}
			}
			for k, v := range meta {
				dev.Metadata[k] = v
			}
			updates["metadata"] = dev.Metadata
		}
	}

	h.db.Model(&models.Device{}).Where("id = ? AND org_id = ?", deviceID, orgID).Updates(updates)

	// Update employee last_active_at
	if empID != nil {
		h.db.Model(&models.Employee{}).Where("id = ?", *empID).Update("last_active_at", now)
	}

	// A device that drops below the posture pass line raises an incident so the
	// admin sees non-compliant machines, mirroring how DLP/malware log events.
	if postureResult != nil && postureResult.Status != "pass" {
		reason := "Device posture needs attention"
		if len(postureResult.Reasons) > 0 {
			reason = strings.Join(postureResult.Reasons, "; ")
		}
		event := models.ActivityEvent{
			OrgID:      orgID,
			EmployeeID: empID,
			DeviceID:   &deviceID,
			EventType:  models.EventTypePolicyViol,
			Action:     models.EventActionAlerted,
			Target:     "device-posture",
			Category:   "device_posture",
			PolicyName: reason,
			RiskScore:  float64(100 - postureResult.Score),
			Metadata: map[string]any{
				"posture_score":  postureResult.Score,
				"posture_status": postureResult.Status,
				"failed":         postureResult.Failed,
				"unknown":        postureResult.Unknown,
			},
			Timestamp: now,
		}
		h.db.Create(&event)
		events := []models.ActivityEvent{event}
		attachEmployees(h.db, events)
		h.hub.BroadcastActivityEvent(events[0])
	}

	resp := gin.H{"status": "ok", "server_time": now}
	if postureResult != nil {
		resp["posture"] = postureResult
	}
	// Working-hours state rides the heartbeat rather than a separate poll: it
	// has to be decided here anyway (the device's clock and timezone belong to
	// the person being monitored), and server_time above gives the agent the
	// anchor it needs to hold the answer until the next beat.
	resp["enforcement"] = h.enforcementFor(deviceID, orgID, empID, now)
	resp["screenshots"] = screenshotConfigFor(h.db, orgID)
	c.JSON(http.StatusOK, resp)
}

// GetConfig handles GET /internal/agent/config
// Agent fetches its policy/proxy configuration.
func (h *AgentHandler) GetConfig(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	var ruleCount int64
	h.db.Model(&models.DomainRule{}).
		Where("(org_id = ? OR org_id IS NULL) AND enabled = true", orgID).
		Count(&ruleCount)

	var policyCount int64
	h.db.Model(&models.Policy{}).
		Where("org_id = ? AND enabled = true", orgID).
		Count(&policyCount)

	// Ownership and the uninstall grant drive what the desktop UI is allowed to
	// offer: a pause state is only meaningful on a personal device, and the
	// uninstall entry only appears where the company has enabled it.
	var dev models.Device
	h.db.Select("ownership").Where("id = ?", deviceID).First(&dev)

	// Names for the desktop UI's profile card — it has no other source for
	// them, and showing an employee a bare UUID would be worse than nothing.
	var orgName string
	h.db.Model(&models.Organization{}).Where("id = ?", orgID).Pluck("name", &orgName)
	var empName string
	if empID != nil {
		var emp models.Employee
		if h.db.Select("first_name", "last_name").Where("id = ?", *empID).First(&emp).Error == nil {
			empName = strings.TrimSpace(emp.FirstName + " " + emp.LastName)
		}
	}

	swgHost, swgPort := swgEndpoint()
	c.JSON(http.StatusOK, gin.H{
		"device_id":          deviceID,
		"org_id":             orgID,
		"ownership":          dev.Ownership,
		"org_name":           orgName,
		"employee_name":      empName,
		"rules_count":        ruleCount,
		"policy_count":       policyCount,
		"proxy_mode":         "http",
		"swg_host":           swgHost,
		"swg_port":           swgPort,
		"check_interval_sec": 60,
		"enforcement":        h.enforcementFor(deviceID, orgID, empID, time.Now()),
		"screenshots":        screenshotConfigFor(h.db, orgID),
	})
}

// screenshotConfigFor tells the agent whether to capture and how often. The
// "when" is enforcement's job (working hours); this is the "whether" — an
// org that hasn't turned screenshots on gets enabled:false and the agent's
// capturer stays dormant.
func screenshotConfigFor(db *gorm.DB, orgID uuid.UUID) gin.H {
	s := screenshotSettingsFor(db, orgID)
	return gin.H{
		"enabled":              s.Enabled,
		"min_interval_seconds": s.MinIntervalSeconds,
		"max_interval_seconds": s.MaxIntervalSeconds,
		"blur":                 s.Blur,
	}
}

// enforcementFor resolves this device's working-hours state. Kept in one place
// because both the heartbeat and the config endpoint must answer identically —
// an agent that got two different answers would flap between paused and armed.
func (h *AgentHandler) enforcementFor(deviceID, orgID uuid.UUID, empID *uuid.UUID, now time.Time) schedule.State {
	var teamID *uuid.UUID
	if empID != nil {
		var emp models.Employee
		if err := h.db.Select("team_id").Where("id = ?", *empID).First(&emp).Error; err == nil {
			teamID = emp.TeamID
		}
	}
	return deviceEnforcement(h.db, orgID, &deviceID, teamID, now)
}

// GetRules handles GET /internal/agent/rules
// The agent's local policy cache pulls its domain block/allow list from here
// directly over the same public HTTPS endpoint the dashboards use — so
// enforcement keeps working from any network (home wifi, mobile hotspot,
// VPN...), unlike a separately-hosted SWG proxy that only a LAN can reach.
func (h *AgentHandler) GetRules(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	ctx := c.Request.Context()
	cacheKey := rulesCacheKey(orgID, empID)

	// Cache hit: the result is fully determined by (orgID, empID) — teamID is
	// derived deterministically from empID, so no other input varies per
	// request. A load test at 1,000 devices measured this handler at ~940ms
	// p50 / ~1.8s p95 (scripts/loadtest/results/baseline-1k-pre-phase1.txt)
	// before this cache, entirely from recomputing the identical ruleset on
	// every one of the ~6 polls/minute every device makes.
	if h.rdb != nil {
		if body, err := h.rdb.Get(ctx, cacheKey).Result(); err == nil {
			// Deliberately NOT sliding this TTL on hit. An earlier version of
			// this cache refreshed the TTL on every hit so a continuously-
			// polling device would stay cached indefinitely — which sounds
			// efficient but is a real correctness bug: since a device polls
			// every 10s (< rulesCacheTTL), its own repeat polls would refresh
			// the TTL before it ever lapsed, so the cache would NEVER expire
			// naturally and an admin's policy change would never reach that
			// device at all, not "within one missed poll" as documented.
			// Caught live: seeded a domain_rules row against a running agent
			// and it never appeared in /internal/agent/rules — the sliding
			// TTL was holding the pre-change empty result forever. Each
			// cache entry now expires unconditionally rulesCacheTTL after it
			// was computed, regardless of hits in between, which is what
			// actually bounds staleness to "one missed poll at worst".
			//
			// The signature is cached alongside the body it was computed
			// over (same key+ttl) rather than re-signed on every hit — a
			// signature is only meaningful over the exact bytes it was made
			// for, so it has to travel with them, not get regenerated. If
			// the sig key is missing (e.g. evicted independently under
			// memory pressure) this falls through to recompute+resign
			// rather than ever serving a body without one — an agent that
			// treats "no signature" as "reject" must never see that from a
			// cache-consistency accident.
			if sig, sigErr := h.rdb.Get(ctx, cacheKey+":sig").Result(); sigErr == nil {
				h.setPolicySignatureHeaders(c, sig)
				etag := rulesETag(body)
				c.Header("ETag", etag)
				if c.GetHeader("If-None-Match") == etag {
					c.Status(http.StatusNotModified)
					return
				}
				c.Data(http.StatusOK, "application/json", []byte(body))
				return
			}
		}
	}

	var rules []models.DomainRule
	h.db.Where("enabled = true AND (org_id = ? OR org_id IS NULL)", orgID).Find(&rules)

	var policies []models.Policy
	h.db.Where("enabled = true AND org_id = ?", orgID).Order("priority ASC").Find(&policies)

	var teamID *uuid.UUID
	if empID != nil {
		var emp models.Employee
		if err := h.db.Select("team_id").Where("id = ?", *empID).First(&emp).Error; err == nil {
			teamID = emp.TeamID
		}
	}

	rules = append(rules, expandPoliciesToDomainRules(h.db, orgID, policies, empID, teamID)...)

	// Application control's network half rides the same list: an app rule
	// contributes its whole domain bundle, so an installed desktop client is
	// cut off from every backend it uses, not just the one host someone
	// happened to put in a policy.
	rules = append(rules, appControlDomainRules(h.db, orgID, empID, teamID)...)

	if empID != nil {
		rules = filterApprovedExceptions(h.db, rules, *empID)
	}

	body, err := json.Marshal(gin.H{"rules": rules})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encode rules"})
		return
	}

	sig := h.signer.Sign(body)
	if h.rdb != nil {
		h.rdb.Set(ctx, cacheKey, body, rulesCacheTTL)
		h.rdb.Set(ctx, cacheKey+":sig", sig, rulesCacheTTL)
	}
	h.setPolicySignatureHeaders(c, sig)

	etag := rulesETag(string(body))
	c.Header("ETag", etag)
	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Data(http.StatusOK, "application/json", body)
}

// rulesETag is a weak content hash, not a security token — collisions just
// cost one extra full response, they never leak data across orgs (the cache
// key itself is already org+employee-scoped).
func rulesETag(body string) string {
	sum := sha256.Sum256([]byte(body))
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}

func (h *AgentHandler) setPolicySignatureHeaders(c *gin.Context, sig string) {
	c.Header("X-Policy-Signature", sig)
	c.Header("X-Policy-Key-Id", h.signer.KeyID())
}

// PolicyPublicKey handles GET /internal/agent/policy-public-key — the only
// half of the signing keypair ever served. An agent fetches this once and
// pins it locally (trust-on-first-use, the same posture the MITM CA-cert
// fetch already uses): re-fetching on every restart would let whoever
// controls the network path at that moment hand a fresh device a different
// key, silently defeating the point of signing at all.
func (h *AgentHandler) PolicyPublicKey(c *gin.Context) {
	deviceID, _, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"key_id":     h.signer.KeyID(),
		"public_key": h.signer.PublicKeyBase64(),
		"algorithm":  "ed25519",
	})
}

// ScanFile handles POST /internal/agent/scan-file
// Agent submits a downloaded file's raw bytes for malware scoring. When
// malware-service is configured this returns a 0-100 risk score with block/
// alert/allow bands (hash reputation + ClamAV + static heuristics + sandbox);
// otherwise it falls back to in-process ClamAV (binary infected/clean). Only
// ever sees plain HTTP downloads, plus HTTPS downloads when SSL Inspection is
// on — otherwise TLS hides the bytes.
func (h *AgentHandler) ScanFile(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	// Spooled to disk rather than read into memory: downloads are not bounded
	// by any product-level size cap, and a handful of concurrent installer
	// downloads would otherwise be gigabytes of heap.
	spool, size, err := spoolBody(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read file", "scanned": false})
		return
	}
	defer spool.Close()

	filename := c.Query("filename")
	contentType := c.Query("content_type")
	destination := c.Query("destination")

	v := scanFileStream(c.Request.Context(), orgID.String(), filename, contentType, destination, spool, size)

	// Log block and alert outcomes (a clean/allow file isn't an incident).
	if v.action == "block" || v.action == "alert" {
		eventAction := models.EventActionAlerted
		if v.action == "block" {
			eventAction = models.EventActionBlocked
		}
		event := models.ActivityEvent{
			OrgID:        orgID,
			EmployeeID:   empID,
			DeviceID:     &deviceID,
			EventType:    models.EventTypeFileOp,
			Action:       eventAction,
			Target:       filename,
			TargetDomain: destination,
			Operation:    OpFileDownload,
			Category:     "malware_detection",
			PolicyName:   v.signature,
			RiskScore:    float64(v.score),
			Metadata: map[string]any{
				"score":         v.score,
				"band":          v.band,
				"verdict":       v.verdict,
				"signature":     v.signature,
				"reasons":       v.reasons,
				"sha256":        v.sha256,
				"would_sandbox": v.wouldSandbox,
			},
			Timestamp: time.Now(),
		}
		h.db.Create(&event)
		events := []models.ActivityEvent{event}
		attachEmployees(h.db, events)
		h.hub.BroadcastActivityEvent(events[0])
		h.alertAdmins(orgID, empID, "Malware blocked in a download", filename, v.signature, v.score, v.action)
	}

	c.JSON(http.StatusOK, gin.H{
		"scanned":   v.scanned,
		"infected":  v.infected,
		"signature": v.signature,
		"action":    v.action,
		"score":     v.score,
		"band":      v.band,
		"verdict":   v.verdict,
		"reason":    fileVerdictReason(v),
	})
}

// fileVerdict unifies a malware scan result from either malware-service (0-100
// score + bands) or the in-process ClamAV fallback (binary infected/clean).
type fileVerdict struct {
	scanned      bool
	infected     bool
	score        int
	band         string
	action       string // block | alert | allow
	verdict      string // malware | suspicious | clean
	signature    string
	sha256       string
	reasons      []string
	wouldSandbox bool
}

// scanFileStream is scanFileContent over an open spool file. Both the remote
// service and the in-process fallback read it as a stream, so file size costs
// scratch space and time — never memory.
func scanFileStream(ctx context.Context, orgID, filename, contentType, destination string, spool *os.File, size int64) fileVerdict {
	if malwareclient.Enabled() {
		if _, err := spool.Seek(0, io.SeekStart); err == nil {
			if v, err := malwareclient.ScanStream(ctx, orgID, filename, contentType, destination, spool, size); err == nil {
				return fileVerdict{
					scanned:      v.Scanned,
					infected:     v.Infected,
					score:        v.Score,
					band:         v.Band,
					action:       v.Action,
					verdict:      v.Verdict,
					signature:    v.Signature,
					sha256:       v.SHA256,
					reasons:      v.Reasons,
					wouldSandbox: v.WouldSandbox,
				}
			} else {
				log.Printf("malware-service scan failed (%v) — falling back to in-process ClamAV", err)
			}
		}
	}

	if _, err := spool.Seek(0, io.SeekStart); err != nil {
		return fileVerdict{scanned: false, band: "allow", action: "allow", verdict: "clean"}
	}
	r := riskengine.ScanReader(spool, size)
	fv := fileVerdict{scanned: r.Scanned, infected: r.Infected, signature: r.Signature, band: "allow", action: "allow", verdict: "clean"}
	if r.Infected {
		fv.score = 100
		fv.band, fv.action, fv.verdict = "block", "block", "malware"
	}
	return fv
}

func scanFileContent(ctx context.Context, orgID, filename, contentType, destination string, data []byte) fileVerdict {
	if malwareclient.Enabled() {
		if v, err := malwareclient.ScanFile(ctx, orgID, filename, contentType, destination, data); err == nil {
			return fileVerdict{
				scanned:      v.Scanned,
				infected:     v.Infected,
				score:        v.Score,
				band:         v.Band,
				action:       v.Action,
				verdict:      v.Verdict,
				signature:    v.Signature,
				sha256:       v.SHA256,
				reasons:      v.Reasons,
				wouldSandbox: v.WouldSandbox,
			}
		} else {
			log.Printf("malware-service scan failed (%v) — falling back to in-process ClamAV", err)
		}
	}

	r := riskengine.ScanBytes(data)
	fv := fileVerdict{scanned: r.Scanned, infected: r.Infected, signature: r.Signature, band: "allow", action: "allow", verdict: "clean"}
	if r.Infected {
		fv.score = 100
		fv.band, fv.action, fv.verdict = "block", "block", "malware"
	}
	return fv
}

func fileVerdictReason(v fileVerdict) string {
	if v.signature != "" {
		return "Malware detected in downloaded file: " + v.signature
	}
	if len(v.reasons) > 0 {
		return v.reasons[0]
	}
	if v.action == "block" {
		return "Malware detected in downloaded file"
	}
	return ""
}

// ScanDLP handles POST /internal/agent/scan-dlp
// Agent submits an outbound request body — a plain-HTTP upload, or an HTTPS
// upload the agent has decrypted via its own TLS termination (MITM) — for
// content scanning against the org's enabled "dlp" policies. Metadata
// travels as query params so the request body stays exactly the bytes being
// evaluated (same convention ScanFile above uses for downloads).
func (h *AgentHandler) ScanDLP(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	spool, size, err := spoolBody(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read content", "scanned": false})
		return
	}
	defer spool.Close()

	filename := c.Query("filename")
	contentType := c.Query("content_type")
	destination := c.Query("destination")
	// Request context, so an incident can report what the person was doing
	// ("Email sent", "Message sent") and not just which host it went to.
	requestPath := c.Query("path")
	requestMethod := c.Query("method")

	var policies []models.Policy
	h.db.Where("org_id = ? AND enabled = true AND type = ?", orgID, models.PolicyTypeDLP).
		Order("priority ASC").Find(&policies)
	var teamID *uuid.UUID
	if empID != nil {
		var employee models.Employee
		if err := h.db.Select("team_id").
			Where("id = ? AND org_id = ?", *empID, orgID).
			First(&employee).Error; err == nil {
			teamID = employee.TeamID
		}
	}
	policies = filterPoliciesByTarget(policies, empID, teamID)

	v := scanDLPStream(c.Request.Context(), orgID.String(), filename, contentType, destination, spool, size, policies)

	resp := gin.H{"scanned": true, "action": "allow", "score": v.score, "band": v.band}
	if !v.matched {
		c.JSON(http.StatusOK, resp)
		return
	}

	// Map the scoring band's action to an event action + the block/allow
	// signal the agent acts on (it only stops an upload on "block"; alert/log
	// are recorded but the upload proceeds).
	eventAction := models.EventActionLogged
	respAction := "allow"
	switch v.action {
	case "block":
		eventAction = models.EventActionBlocked
		respAction = "block"
	case "alert":
		eventAction = models.EventActionAlerted
	}

	event := models.ActivityEvent{
		OrgID:        orgID,
		EmployeeID:   empID,
		DeviceID:     &deviceID,
		EventType:    models.EventTypePolicyViol,
		Action:       eventAction,
		Target:       filename,
		TargetDomain: destination,
		Operation:    classifyOperation(destination, requestPath, requestMethod, contentType, filename),
		Category:     "dlp",
		PolicyID:     v.policyID,
		PolicyName:   v.policyName,
		RiskScore:    float64(v.score),
		Metadata: map[string]any{
			"detectors": v.detectors,
			"matches":   v.previews,
			"score":     v.score,
			"band":      v.band,
			"method":    requestMethod,
			"path":      requestPath,
		},
		Timestamp: time.Now(),
	}
	h.db.Create(&event)
	events := []models.ActivityEvent{event}
	attachEmployees(h.db, events)
	h.hub.BroadcastActivityEvent(events[0])
	h.alertAdmins(orgID, empID, "Sensitive data blocked on its way out", destination,
		strings.Join(v.detectors, ", "), v.score, v.action)

	resp["action"] = respAction
	resp["policy_name"] = v.policyName
	resp["detectors"] = v.detectors
	resp["reason"] = v.reason
	resp["incident_id"] = event.ID.String()
	c.JSON(http.StatusOK, resp)
}

// dlpVerdict is the handler's unified DLP result, whether it came from the
// dlp-service microservice (real 0-100 weighted scoring + block/alert/allow
// bands) or the in-process fallback scanner used when DLP_SERVICE_URL isn't
// configured or the service is unreachable.
type dlpVerdict struct {
	matched    bool
	score      int
	band       string
	action     string // block | alert | log | allow
	policyName string
	policyID   *uuid.UUID
	detectors  []string
	previews   []string
	reason     string
}

func scanDLPContent(ctx context.Context, orgID, filename, contentType, destination string, data []byte, policies []models.Policy) dlpVerdict {
	return scanDLPContentExt(ctx, orgID, filename, contentType, destination, data, policies, nil)
}

// scanDLPContentExt is scanDLPContent plus externalMatches — detector hits
// computed outside dlp-service (currently only ai-service's vision
// classification of an image) that should be folded into the same weighted
// aggregate as the content itself. Dropped silently when the in-process
// fallback scanner is used instead of dlp-service, which has no scoring
// concept to fold them into — a known, pre-existing limitation of that
// fallback (see its own doc comment).
func scanDLPContentExt(ctx context.Context, orgID, filename, contentType, destination string, data []byte,
	policies []models.Policy, externalMatches []dlpclient.ExternalMatch) dlpVerdict {
	// Automatic DLP: when an org hasn't authored an applicable custom DLP
	// policy, every upload is still scanned against a built-in default ruleset
	// (all detectors on, score >= 80 blocks, 50-79 alerts). Companies never have
	// to create a
	// policy to get protection; a custom policy simply overrides the default.
	if len(policies) == 0 {
		policies = []models.Policy{defaultDLPPolicy()}
	}

	if dlpclient.Enabled() {
		envelopes := buildDLPEnvelopes(policies)
		if v, err := dlpclient.ScanExt(ctx, orgID, filename, contentType, destination, data, envelopes, externalMatches); err == nil {
			return verdictFromService(v, policies)
		} else {
			log.Printf("dlp-service scan failed (%v) — falling back to in-process scanner", err)
		}
	}
	return verdictFromLocal(dlp.Scan(policies, filename, contentType, data))
}

// DefaultDLPPolicyName labels events produced by the built-in automatic DLP
// ruleset, so incidents from it are distinguishable from custom-policy hits.
const DefaultDLPPolicyName = "Automatic DLP (default)"

// defaultDLPPolicy is the always-on ruleset used when an org has no custom DLP
// policies. It enables every built-in detector and carries the 80/50 score
// thresholds the dlp-service scorer uses for its block/alert/allow bands.
//
// Note: the in-process fallback scanner (dlp.Scan, used only when dlp-service
// isn't deployed) has no 0-100 scoring — it acts on the policy Action on any
// detector match. We set Action=block there so sensitive uploads are still
// stopped; the graduated 70/50 banding requires dlp-service.
func defaultDLPPolicy() models.Policy {
	return models.Policy{
		Name:     DefaultDLPPolicyName,
		Type:     models.PolicyTypeDLP,
		Action:   models.PolicyActionBlock,
		Enabled:  true,
		Priority: 1000, // lowest precedence — any real policy wins
		Rules: map[string]any{
			"detectors": []any{
				string(dlp.DetectorCreditCard),
				string(dlp.DetectorPAN),
				string(dlp.DetectorAadhaar),
				string(dlp.DetectorAWSKey),
				string(dlp.DetectorGitHubToken),
				string(dlp.DetectorGenericAPIKey),
				string(dlp.DetectorSourceCode),
				// LLM tiers — on by default so semantic sensitivity
				// (contracts, salary sheets, photographed IDs, spoken
				// secrets) is caught with zero setup, exactly like the
				// checksum detectors above. Only fire when ai-service is
				// configured (AI_SERVICE_URL); otherwise a no-op.
				"ai_text",
				"ai_visual",
				"ai_audio",
			},
			"block_threshold": 80,
			"alert_threshold": 50,
		},
	}
}

func verdictFromService(v *dlpclient.Verdict, policies []models.Policy) dlpVerdict {
	previews := make([]string, 0, len(v.Matches))
	for _, m := range v.Matches {
		previews = append(previews, m.Label+": "+m.MaskedPreview)
	}
	var policyID *uuid.UUID
	for i := range policies {
		if policies[i].Name == v.PolicyName {
			policyID = &policies[i].ID
			break
		}
	}
	reason := v.Reason
	if reason == "" && v.Matched {
		reason = "Sensitive company data detected"
	}
	return dlpVerdict{
		matched:    v.Matched,
		score:      v.Score,
		band:       v.Band,
		action:     v.Action,
		policyName: v.PolicyName,
		policyID:   policyID,
		detectors:  v.Detectors,
		previews:   previews,
		reason:     reason,
	}
}

func verdictFromLocal(result dlp.Result) dlpVerdict {
	if !result.Matched {
		return dlpVerdict{matched: false, action: "allow", band: "allow"}
	}
	detectors := make([]string, 0, len(result.Matches))
	previews := make([]string, 0, len(result.Matches))
	for _, m := range result.Matches {
		detectors = append(detectors, string(m.Detector))
		previews = append(previews, m.Label+": "+m.Preview)
	}
	action, band := "log", "allow"
	switch result.Action {
	case models.PolicyActionBlock:
		action, band = "block", "block"
	case models.PolicyActionAlert:
		action, band = "alert", "alert"
	case models.PolicyActionAllow:
		action = "allow"
	}
	reason := "Sensitive company data detected"
	if len(result.Matches) > 0 {
		reason = "Sensitive company data detected: " + result.Matches[0].Label
	}
	policyName := ""
	var policyID *uuid.UUID
	if result.Policy != nil {
		policyName = result.Policy.Name
		policyID = &result.Policy.ID
	}
	return dlpVerdict{
		matched:    true,
		score:      0,
		band:       band,
		action:     action,
		policyName: policyName,
		policyID:   policyID,
		detectors:  detectors,
		previews:   previews,
		reason:     reason,
	}
}

// buildDLPEnvelopes flattens each org DLP policy's jsonb Rules into the
// scanning config dlp-service expects. Missing/malformed fields degrade to
// empty rather than erroring, mirroring dlp.parseRules.
func buildDLPEnvelopes(policies []models.Policy) []dlpclient.PolicyEnvelope {
	envelopes := make([]dlpclient.PolicyEnvelope, 0, len(policies))
	for i := range policies {
		p := &policies[i]
		// Every slice starts empty rather than nil: a nil slice marshals to
		// JSON null, and dlp-service's schema types these as lists, so null
		// fails validation with a 422 — which the caller then swallows as
		// "service unavailable" and quietly downgrades to the in-process
		// scanner. Empty lists keep the real scorer in play.
		env := dlpclient.PolicyEnvelope{
			Name:            p.Name,
			Action:          string(p.Action),
			Priority:        p.Priority,
			Detectors:       []string{},
			Keywords:        []string{},
			CustomPatterns:  []dlpclient.CustomPattern{},
			BypassFileTypes: []string{},
			DetectorWeights: map[string]int{},
		}
		r := p.Rules
		if v := stringSliceFromAny(r["detectors"]); v != nil {
			env.Detectors = v
		}
		if v := stringSliceFromAny(r["keywords"]); v != nil {
			env.Keywords = v
		}
		if v := stringSliceFromAny(r["bypass_file_types"]); v != nil {
			env.BypassFileTypes = v
		}
		if list, ok := r["custom_patterns"].([]any); ok {
			for _, v := range list {
				m, ok := v.(map[string]any)
				if !ok {
					continue
				}
				name, _ := m["name"].(string)
				regex, _ := m["regex"].(string)
				if regex == "" {
					continue
				}
				env.CustomPatterns = append(env.CustomPatterns, dlpclient.CustomPattern{Name: name, Regex: regex})
			}
		}
		if weights, ok := r["detector_weights"].(map[string]any); ok {
			for k, v := range weights {
				if n, ok := anyToInt(v); ok {
					env.DetectorWeights[k] = n
				}
			}
		}
		if n, ok := anyToInt(r["block_threshold"]); ok {
			env.BlockThreshold = &n
		}
		if n, ok := anyToInt(r["alert_threshold"]); ok {
			env.AlertThreshold = &n
		}
		envelopes = append(envelopes, env)
	}
	return envelopes
}

func stringSliceFromAny(v any) []string {
	list, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		if s, ok := item.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

func anyToInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	}
	return 0, false
}

// ─── MITM / SSL Inspection ─────────────────────────────────────────────────────

// defaultMITMBypassDomains is always excluded from interception regardless
// of org settings — certificate-pinned OS/update services that would
// actually break (not just "fail open") if MITM'd, so this is a safety
// floor, not a suggestion.
func defaultMITMBypassDomains() []string {
	return []string{
		"swupd.apple.com", "mesu.apple.com", "gs.apple.com",
		"ocsp.apple.com", "crl.apple.com", "valid.apple.com",
		"xp.apple.com", "gdmf.apple.com", "appleid.apple.com",
		"windowsupdate.com", "update.microsoft.com", "delivery.mp.microsoft.com",
		"login.microsoftonline.com", "login.live.com",
		"clients2.google.com", "clients4.google.com", "dl.google.com",
		"update.googleapis.com", "accounts.google.com",
		"addons.mozilla.org", "aus5.mozilla.org",
	}
}

func sensitiveMITMBypassDomains(db *gorm.DB) []string {
	slugs := []string{"banking_finance_sensitive", "government_sensitive", "healthcare_sensitive"}
	var domains []string
	db.Model(&models.CategoryDomain{}).
		Joins("JOIN url_categories ON url_categories.id = category_domains.category_id").
		Where("url_categories.slug IN ?", slugs).
		Pluck("category_domains.domain", &domains)
	return domains
}

func mitmSettingsFromOrg(org *models.Organization) (enabled bool, bypass []string) {
	enabled, _ = org.Settings["mitm_enabled"].(bool)
	if extra, ok := org.Settings["mitm_bypass_domains"].([]any); ok {
		for _, v := range extra {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				bypass = append(bypass, strings.ToLower(strings.TrimSpace(s)))
			}
		}
	}
	return enabled, bypass
}

// injectNoticeFromOrg reports whether a blocked upload should also get the
// agent's in-page notice shim injected into the page that triggered it (see
// aavishield-agent.py's _inject_block_shim) — the mechanism that lets an
// XHR/fetch-based upload (Gmail, Slack, Teams, Outlook Web — none of which
// use a plain form POST) show the real block reason instead of a generic
// "Upload failed". Defaults to true (on) so existing orgs get the notice
// without any migration step; an org can opt a sensitive/fragile site out
// via this same org-level setting alongside mitm_bypass_domains.
func injectNoticeFromOrg(org *models.Organization) bool {
	if v, ok := org.Settings["mitm_inject_notice"].(bool); ok {
		return v
	}
	return true
}

// GetMITMConfig handles GET /internal/agent/mitm-config
// Agent checks whether TLS interception is enabled for its org, and which
// hostnames to always blind-tunnel instead of terminating.
func (h *AgentHandler) GetMITMConfig(c *gin.Context) {
	deviceID, orgID, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	var org models.Organization
	if err := h.db.Where("id = ?", orgID).First(&org).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	enabled, orgBypass := mitmSettingsFromOrg(&org)
	bypass := append(defaultMITMBypassDomains(), orgBypass...)
	bypass = append(bypass, sensitiveMITMBypassDomains(h.db)...)

	c.JSON(http.StatusOK, gin.H{
		"enabled":        enabled,
		"bypass_domains": bypass,
		"inject_notice":  injectNoticeFromOrg(&org),
	})
}

// GetCACert handles GET /internal/agent/ca-cert
// Returns this org's root CA certificate (public only) so the agent can
// install it into the OS/browser trust store on enrollment.
func (h *AgentHandler) GetCACert(c *gin.Context) {
	deviceID, orgID, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	ca, err := mitm.EnsureOrgCA(h.db, orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load organization CA"})
		return
	}

	c.Header("Content-Type", "application/x-pem-file")
	c.String(http.StatusOK, string(ca.CertPEM))
}

// SignCert handles POST /internal/agent/sign-cert
// Agent asks for a short-lived leaf certificate for a specific hostname
// it's about to terminate TLS for. See internal/mitm.IssueLeafCert for why
// the key pair is generated here rather than by the agent.
func (h *AgentHandler) SignCert(c *gin.Context) {
	deviceID, orgID, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	var req struct {
		Hostname string `json:"hostname" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ca, err := mitm.EnsureOrgCA(h.db, orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load organization CA"})
		return
	}

	certPEM, keyPEM, err := mitm.IssueLeafCert(ca, req.Hostname)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"cert_pem":   string(certPEM),
		"key_pem":    string(keyPEM),
		"expires_in": int(mitm.LeafCertValidity.Seconds()),
	})
}

// ThreatLookup handles GET /internal/agent/threat-lookup?domain=example.com.
// It lets the endpoint enforce threat-intel risk inline before connecting,
// not just expose a dashboard-only lookup.
func (h *AgentHandler) ThreatLookup(c *gin.Context) {
	deviceID, orgID, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	domain := strings.ToLower(strings.TrimSpace(c.Query("domain")))
	domain = strings.TrimPrefix(domain, "www.")
	if domain == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "domain is required"})
		return
	}

	if threatintelclient.Enabled() {
		if r, err := threatintelclient.Lookup(c.Request.Context(), orgID.String(), "domain", domain); err == nil {
			c.JSON(http.StatusOK, r)
			return
		}
	}

	a := riskengine.Assess(h.db, domain)
	band := "allow"
	if a.Score >= 80 {
		band = "block"
	} else if a.Score >= 50 {
		band = "alert"
	}
	c.JSON(http.StatusOK, gin.H{
		"indicator":        a.Domain,
		"kind":             "domain",
		"score":            a.Score,
		"band":             band,
		"category":         a.Category,
		"threat_intel_hit": a.ThreatIntel,
		"reasons":          a.Reasons,
	})
}

// CASBAppControl handles GET /internal/agent/casb/app-control?domain=&activity=upload|download|browse.
// It turns the dashboard CASB app-control evaluator into an inline endpoint
// the agent can call before sensitive SaaS activities.
func (h *AgentHandler) CASBAppControl(c *gin.Context) {
	deviceID, orgID, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	domain := strings.ToLower(strings.TrimSpace(c.Query("domain")))
	domain = strings.TrimPrefix(strings.TrimSuffix(domain, "."), "www.")
	if domain == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "domain is required"})
		return
	}
	activity := strings.ToLower(strings.TrimSpace(c.DefaultQuery("activity", "browse")))
	if activity == "" {
		activity = "browse"
	}

	if !casbclient.Enabled() {
		c.JSON(http.StatusOK, gin.H{"action": "allow", "reason": "casb-service is not configured"})
		return
	}

	appName := domain
	category := "unknown"
	riskScore := 0
	if shadowitclient.Enabled() {
		if results, err := shadowitclient.Classify(c.Request.Context(), orgID.String(), []string{domain}); err == nil && len(results) > 0 {
			res := results[0]
			if res.App != "" {
				appName = res.App
			}
			if res.Category != "" {
				category = res.Category
			}
			riskScore = res.RiskScore
		}
	}

	sanctioned := false
	var rule models.DomainRule
	if err := h.db.Where("(org_id = ? OR org_id IS NULL) AND domain = ? AND enabled = ?", orgID, domain, true).
		Order("org_id IS NULL ASC").
		First(&rule).Error; err == nil {
		sanctioned = rule.Action == models.PolicyActionAllow
		if rule.Action == models.PolicyActionBlock {
			c.JSON(http.StatusOK, gin.H{
				"action":       "block",
				"reason":       "Shadow IT review decision",
				"matched_rule": "Shadow IT block",
			})
			return
		}
	}

	// The org's own app-control rules are evaluated ahead of casb-service's
	// built-in defaults, so a company can loosen or tighten any of them.
	status, resp, err := casbclient.Post(c.Request.Context(), orgID.String(), "/v1/app-control", map[string]any{
		"app":        appName,
		"category":   category,
		"activity":   activity,
		"sanctioned": sanctioned,
		"risk_score": riskScore,
		"rules":      casbRulePayload(orgCASBRules(h.db, orgID.String())),
	})
	if err != nil || status >= 500 {
		c.JSON(http.StatusOK, gin.H{"action": "allow", "reason": "casb-service unavailable"})
		return
	}
	c.JSON(status, resp)
}

// GetMITMSettings handles GET /settings/mitm (company dashboard)
// Lets an org admin see and configure whether SSL inspection (needed for
// DLP to see inside HTTPS uploads) is on, and which extra domains to
// exclude from interception (e.g. an internal banking portal that pins
// certificates).
func (h *AgentHandler) GetMITMSettings(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var org models.Organization
	if err := h.db.Where("id = ?", orgID).First(&org).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	enabled, bypass := mitmSettingsFromOrg(&org)
	defaultBypass := append(defaultMITMBypassDomains(), sensitiveMITMBypassDomains(h.db)...)
	c.JSON(http.StatusOK, gin.H{
		"enabled":                enabled,
		"bypass_domains":         bypass,
		"default_bypass_domains": defaultBypass,
		"inject_notice":          injectNoticeFromOrg(&org),
	})
}

// UpdateMITMSettings handles PUT /settings/mitm (company dashboard)
func (h *AgentHandler) UpdateMITMSettings(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")

	var req struct {
		Enabled       bool     `json:"enabled"`
		BypassDomains []string `json:"bypass_domains"`
		// Pointer so "omitted" (leave as-is) is distinguishable from
		// "explicitly false" — every other MITM settings field here already
		// gets fully overwritten on every PUT, but this one ships after
		// existing dashboard clients that don't know about it yet, and
		// those must not silently flip it off just by saving the form.
		InjectNotice *bool `json:"inject_notice"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var org models.Organization
	if err := h.db.Where("id = ?", orgID).First(&org).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}
	if org.Settings == nil {
		org.Settings = map[string]any{}
	}

	bypass := make([]any, 0, len(req.BypassDomains))
	cleaned := make([]string, 0, len(req.BypassDomains))
	for _, d := range req.BypassDomains {
		if d = strings.ToLower(strings.TrimSpace(d)); d != "" {
			bypass = append(bypass, d)
			cleaned = append(cleaned, d)
		}
	}
	org.Settings["mitm_enabled"] = req.Enabled
	org.Settings["mitm_bypass_domains"] = bypass
	injectNotice := injectNoticeFromOrg(&org)
	if req.InjectNotice != nil {
		injectNotice = *req.InjectNotice
	}
	org.Settings["mitm_inject_notice"] = injectNotice

	if err := h.db.Model(&org).Update("settings", org.Settings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update settings"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"enabled": req.Enabled, "bypass_domains": cleaned, "inject_notice": injectNotice})
}

// ReportOffline handles POST /internal/agent/offline
// Agent calls this when it is shutting down.
func (h *AgentHandler) ReportOffline(c *gin.Context) {
	deviceID, orgID, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	now := time.Now()
	h.db.Model(&models.Device{}).
		Where("id = ? AND org_id = ?", deviceID, orgID).
		Updates(map[string]any{"status": "offline", "last_seen_at": now})
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// ─── Activity Reporting (agent reports events) ────────────────────────────────

// ReportActivity handles POST /internal/agent/activity
// Agent sends batched activity events (app launches, URL visits, etc.).
func (h *AgentHandler) ReportActivity(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	var events []models.ActivityEvent
	if err := c.ShouldBindJSON(&events); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var device models.Device
	h.db.Select("ip_address", "metadata").
		Where("id = ? AND org_id = ?", deviceID, orgID).
		First(&device)
	geoCountry, _ := device.Metadata["geo_country"].(string)
	geoCity, _ := device.Metadata["geo_city"].(string)

	devID := deviceID
	for i := range events {
		events[i].OrgID = orgID
		events[i].DeviceID = &devID
		if empID != nil && events[i].EmployeeID == nil {
			events[i].EmployeeID = empID
		}
		if events[i].Timestamp.IsZero() {
			events[i].Timestamp = time.Now()
		}
		if events[i].IPAddress == "" {
			events[i].IPAddress = device.IPAddress
		}
		if events[i].GeoCountry == "" {
			events[i].GeoCountry = geoCountry
		}
		if events[i].GeoCity == "" {
			events[i].GeoCity = geoCity
		}
	}

	if err := h.db.CreateInBatches(events, 100).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save events"})
		return
	}

	// Look up the employee once so live broadcasts can show a name, not just
	// an ID, in the company dashboard.
	attachEmployees(h.db, events)

	for _, ev := range events {
		h.hub.BroadcastActivityEvent(ev)
	}

	c.JSON(http.StatusCreated, gin.H{"created": len(events)})
}

// ─── Device Management (company dashboard) ───────────────────────────────────

// ListDevices handles GET /devices
func (h *AgentHandler) ListDevices(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	empID := c.Query("employee_id")

	q := h.db.Where("org_id = ?", orgID)
	q = applyEmployeeTeamScope(h.db, c, q, "employee_id")
	if empID != "" {
		q = q.Where("employee_id = ?", empID)
	}

	var devices []models.Device
	q.Order("last_seen_at DESC").Find(&devices)
	attachEmployeesToDevices(h.db, devices)

	// Each device carries the working-hours state it is actually under, so the
	// list can show "paused until Monday" without a request per row.
	org, _ := uuid.Parse(orgID)
	now := time.Now()
	rows := make([]gin.H, 0, len(devices))
	for i := range devices {
		d := &devices[i]
		state := deviceEnforcement(h.db, org, &d.ID, teamIDForDevice(h.db, d), now)
		rows = append(rows, gin.H{"device": d, "enforcement": state})
	}

	c.JSON(http.StatusOK, gin.H{"data": devices, "total": len(devices), "rows": rows})
}

// GetDevice handles GET /devices/:id
func (h *AgentHandler) GetDevice(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	devID := c.Param("id")

	var device models.Device
	if err := h.db.Where("id = ? AND org_id = ?", devID, orgID).
		First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}
	devices := []models.Device{device}
	attachEmployeesToDevices(h.db, devices)
	device = devices[0]

	var recentEvents []models.ActivityEvent
	h.db.Where("device_id = ?", device.ID).
		Order("timestamp DESC").Limit(20).Find(&recentEvents)

	org, _ := uuid.Parse(orgID)
	c.JSON(http.StatusOK, gin.H{
		"device":        device,
		"recent_events": recentEvents,
		"enforcement":   deviceEnforcement(h.db, org, &device.ID, teamIDForDevice(h.db, &device), time.Now()),
	})
}

// RevokeDevice handles DELETE /devices/:id
// Revokes the device's agent token so it can no longer report events.
func (h *AgentHandler) RevokeDevice(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	devID := c.Param("id")

	var device models.Device
	if err := h.db.Where("id = ? AND org_id = ?", devID, orgID).First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	// Look up the live token hash before revoking so the Redis cache entry
	// (agentTokenCacheTTL, see authAgent) can be evicted immediately — without
	// this, a stolen/compromised device stays authenticated against the cache
	// for up to a minute after an admin revokes it.
	var tok models.AgentToken
	hasToken := h.db.Where("device_id = ? AND revoked = false", devID).First(&tok).Error == nil

	h.db.Model(&models.AgentToken{}).Where("device_id = ?", devID).Update("revoked", true)
	h.db.Model(&device).Update("status", "revoked")

	if hasToken && h.rdb != nil {
		h.rdb.Del(c.Request.Context(), agentTokenCacheKey(devID, tok.TokenHash))
	}

	c.JSON(http.StatusOK, gin.H{"message": "Device revoked. The agent will stop reporting on next heartbeat."})
}

// ─── Offline sweep ─────────────────────────────────────────────────────────────

// StartDeviceOfflineSweep periodically flips devices to "offline" when
// they've missed too many heartbeats. Heartbeats land every 60s; a graceful
// uninstall/shutdown calls ReportOffline directly, but an abrupt one (crash,
// force-quit, battery death, kill -9) never does, so without this sweep a
// device would stay "online" forever once its last heartbeat stops arriving.
func StartDeviceOfflineSweep(db *gorm.DB, interval, staleAfter time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		for range ticker.C {
			cutoff := time.Now().Add(-staleAfter)
			db.Model(&models.Device{}).
				Where("status = 'online' AND (last_seen_at IS NULL OR last_seen_at < ?)", cutoff).
				Update("status", "offline")
		}
	}()
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

// authAgent validates the Authorization: Bearer <device_id>:<agent_key> header.
// Returns (deviceID, orgID, employeeID); writes 401 and returns zero values on failure.
func (h *AgentHandler) authAgent(c *gin.Context) (uuid.UUID, uuid.UUID, *uuid.UUID) {
	header := c.GetHeader("Authorization")
	if header == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization required"})
		return uuid.Nil, uuid.Nil, nil
	}

	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Expected Bearer token"})
		return uuid.Nil, uuid.Nil, nil
	}

	creds := parts[1]
	colonIdx := strings.Index(creds, ":")
	if colonIdx < 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Token format must be device_id:agent_key"})
		return uuid.Nil, uuid.Nil, nil
	}

	deviceID := creds[:colonIdx]
	agentKey := creds[colonIdx+1:]
	keyHash := agentKeyHash(agentKey)
	ctx := c.Request.Context()
	cacheKey := agentTokenCacheKey(deviceID, keyHash)

	var cached cachedAgentToken
	cacheHit := false
	if h.rdb != nil {
		if raw, err := h.rdb.Get(ctx, cacheKey).Result(); err == nil {
			if json.Unmarshal([]byte(raw), &cached) == nil {
				cacheHit = true
			}
		}
	}

	var orgID uuid.UUID
	var empID *uuid.UUID
	if cacheHit {
		orgID, empID = cached.OrgID, cached.EmployeeID
	} else {
		var tok models.AgentToken
		if err := h.db.Where("device_id = ? AND token_hash = ? AND revoked = false", deviceID, keyHash).
			First(&tok).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or revoked agent token"})
			return uuid.Nil, uuid.Nil, nil
		}
		orgID, empID = tok.OrgID, tok.EmployeeID

		if h.rdb != nil {
			if raw, err := json.Marshal(cachedAgentToken{OrgID: orgID, EmployeeID: empID}); err == nil {
				h.rdb.Set(ctx, cacheKey, raw, agentTokenCacheTTL)
			}
		}
	}

	// last_used_at is bookkeeping, not correctness — debounce the write to at
	// most once per agentLastSeenDebounce per device instead of once per call.
	// Before this, every single agent request (heartbeat/60s, rules/10s,
	// activity/5s) issued its own UPDATE; at 100k devices that's ~64k writes/s
	// against a 25-connection pool for a column nothing reads with that
	// freshness requirement.
	shouldWriteLastSeen := true
	if h.rdb != nil {
		seenKey := agentLastSeenKey(deviceID)
		ok, err := h.rdb.SetNX(ctx, seenKey, "1", agentLastSeenDebounce).Result()
		shouldWriteLastSeen = err != nil || ok
	}
	if shouldWriteLastSeen {
		now := time.Now()
		h.db.Model(&models.AgentToken{}).Where("device_id = ?", deviceID).Update("last_used_at", now)
	}

	devUUID, _ := uuid.Parse(deviceID)
	return devUUID, orgID, empID
}

// attachEmployeesToDevices batch-fetches each distinct employee referenced by
// devices and sets d.Employee on each one. Used instead of Preload("Employee")
// — see attachEmployees in activity.go for why Preload silently fails here.
func attachEmployeesToDevices(db *gorm.DB, devices []models.Device) {
	empIDs := make(map[uuid.UUID]bool)
	for _, d := range devices {
		if d.EmployeeID != nil {
			empIDs[*d.EmployeeID] = true
		}
	}
	if len(empIDs) == 0 {
		return
	}

	ids := make([]uuid.UUID, 0, len(empIDs))
	for id := range empIDs {
		ids = append(ids, id)
	}
	var emps []models.Employee
	db.Where("id IN ?", ids).Find(&emps)

	empByID := make(map[uuid.UUID]models.Employee, len(emps))
	for _, e := range emps {
		empByID[e.ID] = e
	}

	for i := range devices {
		if devices[i].EmployeeID == nil {
			continue
		}
		if emp, ok := empByID[*devices[i].EmployeeID]; ok {
			e := emp
			devices[i].Employee = &e
		}
	}
}

func agentKeyHash(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// alertAdmins emails an immediate security notice. Only genuine blocks qualify:
// alert-band events are summarised in the digest instead, because one email per
// flagged upload is how a security product trains its admins to ignore it.
func (h *AgentHandler) alertAdmins(orgID uuid.UUID, empID *uuid.UUID, title, target, detail string, score int, action string) {
	if action != "block" {
		return
	}
	admins := notifier.AdminEmails(h.db, orgID.String())
	if len(admins) == 0 {
		return
	}

	var org models.Organization
	orgName := "your organization"
	if err := h.db.First(&org, "id = ?", orgID).Error; err == nil {
		orgName = org.Name
		// The org can turn immediate alerts off and rely on the digest instead.
		if !org.WantsNotification("security_alerts") {
			return
		}
	}
	empName := "An employee"
	if empID != nil {
		var emp models.Employee
		if err := h.db.First(&emp, "id = ?", *empID).Error; err == nil {
			empName = emp.FullName()
		}
	}

	mailer.SecurityAlert(admins, orgName, title, empName, target, detail, score)
}
