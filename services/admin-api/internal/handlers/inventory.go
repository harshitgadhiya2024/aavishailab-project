package handlers

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Software inventory: the agent reports what is installed, the company sees it
// per employee, and can block any of it — including software nobody
// catalogued in advance.

type InventoryHandler struct {
	db  *gorm.DB
	hub *WebSocketHub
}

func NewInventoryHandler(db *gorm.DB, hub *WebSocketHub) *InventoryHandler {
	return &InventoryHandler{db: db, hub: hub}
}

// ─── Agent ingest ────────────────────────────────────────────────────────────

type inventoryItem struct {
	Identifier  string `json:"identifier"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Vendor      string `json:"vendor"`
	InstallPath string `json:"install_path"`
	Source      string `json:"source"`
	// InstalledAt as the OS reports it, RFC3339. Empty on the platforms that
	// don't record one — FirstSeenAt then carries the meaning instead.
	InstalledAt string `json:"installed_at"`
}

// maxInventoryItems caps one report. A developer machine realistically carries
// a few hundred applications; anything past this is a malformed or hostile
// payload, and truncating is better than letting one device write unbounded
// rows. The agent sorts its list, so a truncated report is at least stable
// between runs rather than a different arbitrary subset each time.
const maxInventoryItems = 2000

// ReportInventory handles POST /internal/agent/inventory — the device's
// complete list of installed applications.
//
// The report is a full snapshot, not a delta, which is what lets uninstalls be
// detected at all: anything previously seen on this device and absent from the
// snapshot is marked Removed. A delta protocol would need the agent to
// remember what it last sent and stay in sync across restarts, reinstalls and
// version upgrades — state it has no reliable place to keep, and which would
// go wrong silently.
func (h *InventoryHandler) ReportInventory(c *gin.Context) {
	ah := &AgentHandler{db: h.db}
	deviceID, orgID, empID := ah.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	var in struct {
		Applications []inventoryItem `json:"applications"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(in.Applications) > maxInventoryItems {
		in.Applications = in.Applications[:maxInventoryItems]
	}

	now := time.Now()
	catalog := h.loadCatalog(orgID)

	// Everything this device has ever reported, so the snapshot can be diffed
	// against it in memory rather than with one query per item.
	var existing []models.InstalledApplication
	h.db.Where("device_id = ?", deviceID).Find(&existing)
	byIdentifier := make(map[string]models.InstalledApplication, len(existing))
	for _, e := range existing {
		byIdentifier[e.Identifier] = e
	}

	seen := make(map[string]bool, len(in.Applications))
	var newlyInstalled []models.InstalledApplication

	for _, item := range in.Applications {
		identifier := inventoryIdentifier(item)
		name := strings.TrimSpace(item.Name)
		if identifier == "" || name == "" {
			continue
		}
		// A device that reports the same identifier twice in one snapshot (the
		// same app found by two collectors) must not produce two rows.
		if seen[identifier] {
			continue
		}
		seen[identifier] = true

		match := catalog.match(name, identifier, item.InstallPath)

		if prev, ok := byIdentifier[identifier]; ok {
			updates := map[string]any{
				"last_seen_at": now,
				"name":         name,
				"version":      strings.TrimSpace(item.Version),
				"vendor":       strings.TrimSpace(item.Vendor),
				"install_path": strings.TrimSpace(item.InstallPath),
				"source":       strings.TrimSpace(item.Source),
				"employee_id":  empID,
				"category":     match.category,
				"risk_level":   match.risk,
			}
			if match.appID != nil {
				updates["application_id"] = *match.appID
			}
			// Coming back after an uninstall is a reinstall, and it should read
			// as one: clear the removal and move the clock forward rather than
			// resurrecting a row that still claims it was first seen months ago
			// and removed since.
			if prev.Removed {
				updates["removed"] = false
				updates["removed_at"] = nil
				updates["first_seen_at"] = now
			}
			h.db.Model(&models.InstalledApplication{}).Where("id = ?", prev.ID).Updates(updates)
			continue
		}

		row := models.InstalledApplication{
			OrgID:         orgID,
			DeviceID:      deviceID,
			EmployeeID:    empID,
			Identifier:    identifier,
			Name:          name,
			Version:       strings.TrimSpace(item.Version),
			Vendor:        strings.TrimSpace(item.Vendor),
			InstallPath:   strings.TrimSpace(item.InstallPath),
			Source:        strings.TrimSpace(item.Source),
			ApplicationID: match.appID,
			Category:      match.category,
			RiskLevel:     match.risk,
			InstalledAt:   parseInventoryTime(item.InstalledAt),
			FirstSeenAt:   now,
			LastSeenAt:    now,
		}
		if err := h.db.Create(&row).Error; err != nil {
			continue
		}
		newlyInstalled = append(newlyInstalled, row)
	}

	// Anything missing from the snapshot has been uninstalled. Only rows not
	// already marked removed are touched, so RemovedAt keeps meaning "when it
	// went away" rather than "the last time we noticed it was still gone".
	var removedIDs []uuid.UUID
	for identifier, prev := range byIdentifier {
		if seen[identifier] || prev.Removed {
			continue
		}
		removedIDs = append(removedIDs, prev.ID)
	}
	if len(removedIDs) > 0 {
		h.db.Model(&models.InstalledApplication{}).Where("id IN ?", removedIDs).
			Updates(map[string]any{"removed": true, "removed_at": now})
	}

	// One activity event per genuinely new application. Emitted after the rows
	// are committed so the Activity tab can never show an install whose
	// inventory row failed to save.
	//
	// Suppressed entirely on a device's first-ever report: a freshly enrolled
	// laptop would otherwise dump its whole existing software estate into the
	// activity trail as hundreds of "installed just now" lines, none of which
	// happened just now. The baseline is recorded as inventory; only what
	// appears *after* it is an install event.
	if len(existing) > 0 {
		for _, row := range newlyInstalled {
			h.recordInstallEvent(row, now)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"recorded": len(seen),
		"new":      len(newlyInstalled),
		"removed":  len(removedIDs),
	})
}

func (h *InventoryHandler) recordInstallEvent(row models.InstalledApplication, now time.Time) {
	deviceID := row.DeviceID
	event := models.ActivityEvent{
		OrgID:       row.OrgID,
		EmployeeID:  row.EmployeeID,
		DeviceID:    &deviceID,
		EventType:   models.EventTypeAppInstall,
		Action:      models.EventActionLogged,
		Target:      row.Name,
		Operation:   "Application installed",
		Category:    "application_control",
		ProcessName: row.Name,
		PolicyName:  "Software inventory",
		RiskScore:   float64(row.RiskLevel),
		Metadata: map[string]any{
			"identifier":   row.Identifier,
			"version":      row.Version,
			"vendor":       row.Vendor,
			"install_path": row.InstallPath,
			"source":       row.Source,
			"app_category": row.Category,
		},
		Timestamp: now,
	}
	if err := h.db.Create(&event).Error; err != nil {
		return
	}
	events := []models.ActivityEvent{event}
	attachEmployees(h.db, events)
	if h.hub != nil {
		h.hub.BroadcastActivityEvent(events[0])
	}
}

// inventoryIdentifier picks the stable key for an application, falling back
// through progressively weaker options. A missing identifier is filled from
// the name rather than dropping the row: an app with no bundle id or package
// record is exactly the manually-installed binary this feature exists to
// catch, and refusing to record it would defeat the point.
func inventoryIdentifier(item inventoryItem) string {
	if id := strings.TrimSpace(item.Identifier); id != "" {
		return strings.ToLower(id)
	}
	if p := strings.TrimSpace(item.InstallPath); p != "" {
		return strings.ToLower(p)
	}
	return strings.ToLower(strings.TrimSpace(item.Name))
}

func parseInventoryTime(raw string) *time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02", "20060102"} {
		if t, err := time.Parse(layout, raw); err == nil {
			// A future install date is a misread registry value, not a fact.
			if t.After(time.Now().Add(24 * time.Hour)) {
				return nil
			}
			return &t
		}
	}
	return nil
}

// ─── Catalog matching ────────────────────────────────────────────────────────

type catalogMatch struct {
	appID    *uuid.UUID
	category string
	risk     int
}

type inventoryCatalog struct {
	apps []models.ManagedApplication
}

func (h *InventoryHandler) loadCatalog(orgID uuid.UUID) inventoryCatalog {
	var apps []models.ManagedApplication
	h.db.Where("org_id IS NULL OR org_id = ?", orgID).Find(&apps)
	return inventoryCatalog{apps: apps}
}

// match links an observed application to a catalog entry.
//
// Matching is deliberately conservative and ordered strongest-first: a bundle
// id or an exact name is proof, a path pattern is good evidence, and nothing
// else counts. Fuzzy name matching is not attempted — mislabelling "Chrome
// Remote Desktop" as "Chrome" would attach the wrong risk score and the wrong
// domain bundle, and a wrong link here is worse than no link, because an
// unmatched row still lands in the list with a heuristic category.
func (cat inventoryCatalog) match(name, identifier, installPath string) catalogMatch {
	lowerName := strings.ToLower(strings.TrimSpace(name))
	lowerID := strings.ToLower(strings.TrimSpace(identifier))
	lowerPath := strings.ToLower(strings.TrimSpace(installPath))

	for _, app := range cat.apps {
		for _, b := range app.BundleIDs {
			if b != "" && strings.EqualFold(strings.TrimSpace(b), lowerID) {
				return catalogMatch{appID: idPtr(app.ID), category: app.Category, risk: app.RiskLevel}
			}
		}
	}
	for _, app := range cat.apps {
		if strings.EqualFold(app.Name, lowerName) {
			return catalogMatch{appID: idPtr(app.ID), category: app.Category, risk: app.RiskLevel}
		}
		for _, p := range app.ProcessNames {
			p = strings.ToLower(strings.TrimSpace(p))
			// Compare against the executable name with its extension removed,
			// so "code.exe" in the catalog matches an inventory row named
			// "Code" and vice versa.
			if p != "" && (p == lowerName || strings.TrimSuffix(p, ".exe") == lowerName) {
				return catalogMatch{appID: idPtr(app.ID), category: app.Category, risk: app.RiskLevel}
			}
		}
	}
	if lowerPath != "" {
		for _, app := range cat.apps {
			for _, pattern := range app.PathPatterns {
				pattern = strings.ToLower(strings.TrimSpace(pattern))
				if pattern != "" && strings.Contains(lowerPath, pattern) {
					return catalogMatch{appID: idPtr(app.ID), category: app.Category, risk: app.RiskLevel}
				}
			}
		}
	}

	category, risk := heuristicCategory(lowerName, lowerPath)
	return catalogMatch{category: category, risk: risk}
}

func idPtr(id uuid.UUID) *uuid.UUID { return &id }

// heuristicCategory gives an uncatalogued application a category and a risk
// score from its own name, so it is triageable the moment it appears instead
// of sitting in an "unknown" bucket nobody sorts.
//
// These are signals, not verdicts — the risk numbers stay below the catalog's
// own so a curated entry always outranks a guess, and "other" at 30 is the
// honest default for software we know nothing about.
func heuristicCategory(name, path string) (string, int) {
	hay := name + " " + path
	contains := func(needles ...string) bool {
		for _, n := range needles {
			if strings.Contains(hay, n) {
				return true
			}
		}
		return false
	}

	switch {
	case contains("teamviewer", "anydesk", "vnc", "remote desktop", "rustdesk", "splashtop"):
		return "remote_access", 75
	case contains("tor browser", "torbrowser", "psiphon", "ultrasurf"):
		return "anonymizer", 80
	case contains("utorrent", "bittorrent", "qbittorrent", "transmission", "deluge"):
		return "p2p", 70
	case contains("openvpn", "wireguard", "nordvpn", "expressvpn", "protonvpn", "hotspot shield"):
		return "vpn", 60
	case contains("chatgpt", "claude", "copilot", "codex", "ollama", "cursor", "perplexity"):
		return "ai_tools", 55
	case contains("dropbox", "google drive", "onedrive", "mega", "box sync", "sync.com"):
		return "file_sharing", 50
	case contains("slack", "discord", "telegram", "whatsapp", "signal", "teams", "zoom", "skype"):
		return "messaging", 35
	case contains("visual studio", "vscode", "code", "intellij", "pycharm", "goland", "xcode", "sublime"):
		return "development", 25
	case contains("chrome", "firefox", "edge", "safari", "brave", "opera"):
		return "browser", 30
	default:
		return "other", 30
	}
}

// ─── Company API ─────────────────────────────────────────────────────────────

// installedEntry is one row of the Application Control table: the observation,
// plus whichever control rule currently covers this employee for it.
type installedEntry struct {
	models.InstalledApplication
	EmployeeName string `json:"employee_name"`
	DeviceName   string `json:"device_name"`
	BlockNetwork bool   `json:"block_network"`
	BlockProcess bool   `json:"block_process"`
	RuleID       string `json:"rule_id,omitempty"`
}

// ListInstalled handles GET /applications/installed — every application seen
// across the org's devices, newest install first.
func (h *InventoryHandler) ListInstalled(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Organization scope required"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 25
	}

	q := h.db.Model(&models.InstalledApplication{}).Where("org_id = ?", orgID)
	q = applyEmployeeTeamScope(h.db, c, q, "employee_id")

	if emp := c.Query("employee_id"); emp != "" {
		q = q.Where("employee_id = ?", emp)
	}
	if cat := c.Query("category"); cat != "" {
		q = q.Where("category = ?", cat)
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		like := "%" + strings.ToLower(search) + "%"
		q = q.Where("LOWER(name) LIKE ? OR LOWER(vendor) LIKE ? OR LOWER(install_path) LIKE ?", like, like, like)
	}
	// Removed software is hidden by default but never deleted — see the model.
	if c.Query("include_removed") != "true" {
		q = q.Where("removed = ?", false)
	}

	var total int64
	q.Session(&gorm.Session{}).Count(&total)

	var rows []models.InstalledApplication
	q.Session(&gorm.Session{}).
		Order("COALESCE(installed_at, first_seen_at) DESC").
		Offset((page - 1) * limit).Limit(limit).
		Find(&rows)

	c.JSON(http.StatusOK, gin.H{
		"data":       h.decorate(orgID, rows),
		"total":      total,
		"page":       page,
		"limit":      limit,
		"pages":      (total + int64(limit) - 1) / int64(limit),
		"categories": h.categories(orgID),
	})
}

// decorate attaches the employee/device names and the current control state
// for each row, in a fixed number of queries regardless of page size.
func (h *InventoryHandler) decorate(orgID uuid.UUID, rows []models.InstalledApplication) []installedEntry {
	out := make([]installedEntry, 0, len(rows))
	if len(rows) == 0 {
		return out
	}

	empIDs := map[uuid.UUID]bool{}
	devIDs := map[uuid.UUID]bool{}
	for _, r := range rows {
		if r.EmployeeID != nil {
			empIDs[*r.EmployeeID] = true
		}
		devIDs[r.DeviceID] = true
	}

	empNames := map[uuid.UUID]string{}
	if len(empIDs) > 0 {
		var emps []models.Employee
		h.db.Select("id, first_name, last_name, email").Where("id IN ?", keys(empIDs)).Find(&emps)
		for _, e := range emps {
			name := strings.TrimSpace(e.FirstName + " " + e.LastName)
			if name == "" {
				name = e.Email
			}
			empNames[e.ID] = name
		}
	}

	devNames := map[uuid.UUID]string{}
	if len(devIDs) > 0 {
		var devs []models.Device
		h.db.Select("id, hostname").Where("id IN ?", keys(devIDs)).Find(&devs)
		for _, d := range devs {
			devNames[d.ID] = d.Hostname
		}
	}

	// Control rules, indexed by the catalog application they cover. A rule
	// only counts for a row when its Targets actually include that row's
	// employee — an org-wide rule covers everyone, a targeted one does not.
	var rules []models.AppControlRule
	h.db.Where("org_id = ? AND enabled = ?", orgID, true).Find(&rules)
	rulesByApp := map[uuid.UUID][]models.AppControlRule{}
	for _, r := range rules {
		rulesByApp[r.ApplicationID] = append(rulesByApp[r.ApplicationID], r)
	}

	for _, r := range rows {
		e := installedEntry{InstalledApplication: r, DeviceName: devNames[r.DeviceID]}
		if r.EmployeeID != nil {
			e.EmployeeName = empNames[*r.EmployeeID]
		}
		if r.ApplicationID != nil {
			for _, rule := range rulesByApp[*r.ApplicationID] {
				if !appRuleCoversEmployee(rule, r.EmployeeID) {
					continue
				}
				e.BlockNetwork = e.BlockNetwork || rule.BlockNetwork
				e.BlockProcess = e.BlockProcess || rule.BlockProcess
				e.RuleID = rule.ID.String()
			}
		}
		out = append(out, e)
	}
	return out
}

func keys(m map[uuid.UUID]bool) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// appRuleCoversEmployee reports whether a control rule applies to one
// employee. An empty/absent Targets means the whole organization, matching
// AppControlRule's documented shape.
func appRuleCoversEmployee(rule models.AppControlRule, employeeID *uuid.UUID) bool {
	ids, ok := rule.Targets["employee_ids"].([]any)
	if !ok || len(ids) == 0 {
		return true
	}
	if employeeID == nil {
		return false
	}
	return idListContains(rule.Targets["employee_ids"], employeeID.String())
}

func (h *InventoryHandler) categories(orgID uuid.UUID) []string {
	var cats []string
	h.db.Model(&models.InstalledApplication{}).
		Where("org_id = ? AND category <> ''", orgID).
		Distinct().Pluck("category", &cats)
	sort.Strings(cats)
	return cats
}

// SetControl handles POST /applications/installed/:id/control — the Network
// Block and App Block switches on one employee's row.
//
// An uncatalogued application has nothing for the agent to enforce against, so
// flipping a switch on one first promotes it into the org's own catalog (see
// ensureCatalogEntry). That promotion is the only way "block this thing I have
// never seen before" can work at all: enforcement is expressed in terms of
// process identity and domain bundles, which have to exist somewhere.
func (h *InventoryHandler) SetControl(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Organization scope required"})
		return
	}
	rowID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid application id"})
		return
	}

	var in struct {
		BlockNetwork *bool `json:"block_network"`
		BlockProcess *bool `json:"block_process"`
		// Whole-company rather than this one employee. Defaults to false:
		// the switch lives on an employee's row, so that is what it should
		// change unless the admin says otherwise.
		AllEmployees bool `json:"all_employees"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var row models.InstalledApplication
	if err := h.db.Where("id = ? AND org_id = ?", rowID, orgID).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Application not found"})
		return
	}

	appID, err := h.ensureCatalogEntry(orgID, row)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not prepare this application for control"})
		return
	}

	targets := map[string]any{}
	if !in.AllEmployees && row.EmployeeID != nil {
		targets["employee_ids"] = []any{row.EmployeeID.String()}
	}

	var rule models.AppControlRule
	err = h.db.Where("org_id = ? AND application_id = ?", orgID, appID).First(&rule).Error
	switch {
	case err == nil:
		updates := map[string]any{"targets": targets, "enabled": true}
		if in.BlockNetwork != nil {
			updates["block_network"] = *in.BlockNetwork
		}
		if in.BlockProcess != nil {
			updates["block_process"] = *in.BlockProcess
		}
		h.db.Model(&models.AppControlRule{}).Where("id = ?", rule.ID).Updates(updates)
		if in.BlockNetwork != nil {
			rule.BlockNetwork = *in.BlockNetwork
		}
		if in.BlockProcess != nil {
			rule.BlockProcess = *in.BlockProcess
		}
	case err == gorm.ErrRecordNotFound:
		rule = models.AppControlRule{
			OrgID:         orgID,
			ApplicationID: appID,
			Action:        "block",
			Enabled:       true,
			BlockNetwork:  in.BlockNetwork != nil && *in.BlockNetwork,
			BlockProcess:  in.BlockProcess != nil && *in.BlockProcess,
			Targets:       targets,
		}
		if err := h.db.Create(&rule).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save the control"})
			return
		}
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save the control"})
		return
	}

	// Neither half on means "not controlled" — keeping a rule that enforces
	// nothing would leave the app looking controlled in every other view.
	if !rule.BlockNetwork && !rule.BlockProcess {
		h.db.Delete(&models.AppControlRule{}, "id = ?", rule.ID)
		c.JSON(http.StatusOK, gin.H{"block_network": false, "block_process": false})
		return
	}

	if userID, ok := c.Get(middleware.ContextKeyUserID); ok {
		if uid, ok := userID.(uuid.UUID); ok {
			h.db.Create(&models.AuditLog{
				OrgID: &orgID, UserID: &uid,
				Action: "update", Resource: "app_control_rule", ResourceID: &rule.ID,
				IPAddress: c.ClientIP(),
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"rule_id":       rule.ID.String(),
		"block_network": rule.BlockNetwork,
		"block_process": rule.BlockProcess,
	})
}

// ensureCatalogEntry returns the catalog application to hang a control rule
// on, creating an org-scoped one from the observation when the software was
// never catalogued.
//
// The generated entry carries only what can be known from an inventory row:
// process identity (the executable's name, the bundle id, the install path).
// It deliberately carries no Domains — we do not know what backends an unknown
// app talks to, and inventing a domain bundle would block the wrong traffic.
// That means Network Block on a generated entry has nothing to act on until
// somebody fills in its domains, and the API says so to the caller.
func (h *InventoryHandler) ensureCatalogEntry(orgID uuid.UUID, row models.InstalledApplication) (uuid.UUID, error) {
	if row.ApplicationID != nil {
		return *row.ApplicationID, nil
	}

	slug := slugifyApp(row.Name)
	var existing models.ManagedApplication
	err := h.db.Where("org_id = ? AND slug = ?", orgID, slug).First(&existing).Error
	if err == nil {
		h.db.Model(&models.InstalledApplication{}).Where("id = ?", row.ID).
			Update("application_id", existing.ID)
		return existing.ID, nil
	}
	if err != gorm.ErrRecordNotFound {
		return uuid.Nil, err
	}

	app := models.ManagedApplication{
		OrgID:       &orgID,
		Name:        row.Name,
		Slug:        slug,
		Vendor:      row.Vendor,
		Category:    row.Category,
		RiskLevel:   row.RiskLevel,
		Description: "Added automatically from " + row.Name + " seen on an employee device",
		Source:      "inventory",
	}
	if base := executableName(row.InstallPath); base != "" {
		app.ProcessNames = []string{base}
	}
	if isBundleIdentifier(row.Identifier) {
		app.BundleIDs = []string{row.Identifier}
	}
	if row.InstallPath != "" {
		app.PathPatterns = []string{strings.ToLower(row.InstallPath)}
	}
	if err := h.db.Create(&app).Error; err != nil {
		return uuid.Nil, err
	}
	h.db.Model(&models.InstalledApplication{}).Where("id = ?", row.ID).Update("application_id", app.ID)
	return app.ID, nil
}

// executableName is the file name at the end of an install path, for use as a
// process-name matcher. Returns "" for a macOS .app bundle path, where the
// directory name is not the executable inside it and guessing would produce a
// matcher that never fires.
func executableName(installPath string) string {
	p := strings.TrimRight(strings.TrimSpace(installPath), "/\\")
	if p == "" || strings.HasSuffix(strings.ToLower(p), ".app") {
		return ""
	}
	if i := strings.LastIndexAny(p, "/\\"); i >= 0 {
		p = p[i+1:]
	}
	return strings.ToLower(p)
}

// isBundleIdentifier recognises reverse-DNS identifiers (com.microsoft.VSCode)
// so only those become BundleIDs matchers — a Windows registry GUID or a
// Linux package name in that field would match nothing on macOS and only add
// noise to the catalog entry.
func isBundleIdentifier(identifier string) bool {
	id := strings.TrimSpace(identifier)
	if strings.Count(id, ".") < 2 || strings.ContainsAny(id, "/\\ ") {
		return false
	}
	return !strings.HasPrefix(id, "{")
}
