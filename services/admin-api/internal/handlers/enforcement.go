package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/schedule"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type EnforcementHandler struct{ db *gorm.DB }

func NewEnforcementHandler(db *gorm.DB) *EnforcementHandler { return &EnforcementHandler{db: db} }

// ─── Resolution ──────────────────────────────────────────────────────────────

// resolveSchedule picks the schedule that governs one device: the device's own
// override, else its team's, else the organization's, else none (always on).
//
// Only enabled schedules take part. A disabled device override therefore falls
// back to the team or org schedule rather than meaning "no schedule" — turning
// off an override should restore the inherited rule, not silently exempt the
// device from all of them.
func resolveSchedule(db *gorm.DB, orgID uuid.UUID, deviceID, teamID *uuid.UUID) *models.EnforcementSchedule {
	var rows []models.EnforcementSchedule
	q := db.Where("org_id = ? AND enabled = true", orgID)
	q.Find(&rows)

	var org, team, device *models.EnforcementSchedule
	for i := range rows {
		r := &rows[i]
		switch r.Scope {
		case "device":
			if deviceID != nil && r.DeviceID != nil && *r.DeviceID == *deviceID {
				device = r
			}
		case "team":
			if teamID != nil && r.TeamID != nil && *r.TeamID == *teamID {
				team = r
			}
		case "org":
			org = r
		}
	}

	switch {
	case device != nil:
		return device
	case team != nil:
		return team
	default:
		return org
	}
}

// deviceEnforcement is the answer the agent and the dashboard both need.
//
// Company-owned hardware is never paused. Working-hours pausing exists for
// BYOD — it's the concession that makes monitoring someone's *personal*
// laptop defensible. On a company machine there is no private time to
// protect, so a schedule that would otherwise pause it is ignored and the
// device stays enforcing around the clock.
func deviceEnforcement(db *gorm.DB, orgID uuid.UUID, deviceID, teamID *uuid.UUID, now time.Time) schedule.State {
	state := schedule.Evaluate(resolveSchedule(db, orgID, deviceID, teamID).Spec(), now)
	if deviceID == nil || state.Mode == "full" {
		return state
	}

	var dev models.Device
	if err := db.Select("ownership").Where("id = ?", *deviceID).First(&dev).Error; err != nil {
		return state // unknown device: leave the schedule's verdict alone
	}
	if dev.Ownership == models.OwnershipPersonal {
		return state
	}

	state.Active = true
	state.Mode = "full"
	state.Reason = "Company-owned device — enforced continuously"
	state.Until = nil
	return state
}

// teamIDForDevice looks up the team a device's employee belongs to. Returns nil
// for an unassigned device, which then inherits the org schedule.
func teamIDForDevice(db *gorm.DB, dev *models.Device) *uuid.UUID {
	if dev == nil || dev.EmployeeID == nil {
		return nil
	}
	var emp models.Employee
	if err := db.Select("team_id").Where("id = ?", *dev.EmployeeID).First(&emp).Error; err != nil {
		return nil
	}
	return emp.TeamID
}

// ─── Company API ─────────────────────────────────────────────────────────────

type scheduleInput struct {
	Timezone     string            `json:"timezone"`
	Windows      []schedule.Window `json:"windows"`
	Holidays     []string          `json:"holidays"`
	OffHoursMode string            `json:"off_hours_mode"`
	Enabled      *bool             `json:"enabled"`
	Note         string            `json:"note"`
}

func (h *EnforcementHandler) upsert(c *gin.Context, scope string, teamID, deviceID *uuid.UUID) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var in scheduleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tz := strings.TrimSpace(in.Timezone)
	if tz == "" {
		// Fall back to the organization's own timezone rather than UTC: a
		// company that already told us where it operates should not have to
		// say it again, and UTC would silently shift everyone's working day.
		var org models.Organization
		if err := h.db.Select("timezone").Where("id = ?", orgID).First(&org).Error; err == nil && org.Timezone != "" {
			tz = org.Timezone
		} else {
			tz = "UTC"
		}
	}

	mode := strings.TrimSpace(in.OffHoursMode)
	if mode != schedule.OffHoursSecurityOnly {
		mode = schedule.OffHoursFullPause
	}

	if err := schedule.Validate(tz, in.Windows, in.Holidays); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	row := models.EnforcementSchedule{
		OrgID:        orgID,
		Scope:        scope,
		TeamID:       teamID,
		DeviceID:     deviceID,
		Timezone:     tz,
		Windows:      in.Windows,
		Holidays:     in.Holidays,
		OffHoursMode: mode,
		Enabled:      boolOr(in.Enabled, true),
		Note:         strings.TrimSpace(in.Note),
	}

	// One schedule per scope target. Unscoped for the same reason as app
	// control rules: these soft-delete, so a previously removed schedule is
	// still on disk and must be revived rather than duplicated.
	q := h.db.Unscoped().Where("org_id = ? AND scope = ?", orgID, scope)
	switch scope {
	case "team":
		q = q.Where("team_id = ?", teamID)
	case "device":
		q = q.Where("device_id = ?", deviceID)
	}

	var existing models.EnforcementSchedule
	err := q.First(&existing).Error
	if err == nil {
		// Save, not a map-based Updates: Windows and Holidays carry a JSON
		// serializer, and updating them through a map bypasses it — the slice
		// went into the column as a bare object, so the schedule read back with
		// no windows at all and every device silently returned to 24×7.
		// Save also clears deleted_at, reviving a schedule that was removed
		// earlier rather than colliding with it.
		row.ID = existing.ID
		row.CreatedAt = existing.CreatedAt
		if err := h.db.Unscoped().Save(&row).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save the schedule"})
			return
		}
		h.db.First(&existing, "id = ?", row.ID)
		c.JSON(http.StatusOK, h.withPreview(&existing))
		return
	}
	if err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to look up the schedule"})
		return
	}

	if err := h.db.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save the schedule"})
		return
	}
	c.JSON(http.StatusCreated, h.withPreview(&row))
}

// withPreview returns the schedule together with what it evaluates to right
// now, so the admin sees the consequence of what they just saved instead of
// having to work it out from a grid of times.
func (h *EnforcementHandler) withPreview(s *models.EnforcementSchedule) gin.H {
	return gin.H{"schedule": s, "state": schedule.Evaluate(s.Spec(), time.Now())}
}

// GetOrgSchedule handles GET /enforcement/schedule
func (h *EnforcementHandler) GetOrgSchedule(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var org models.Organization
	h.db.Select("timezone").Where("id = ?", orgID).First(&org)

	var row models.EnforcementSchedule
	err := h.db.Where("org_id = ? AND scope = 'org'", orgID).First(&row).Error
	if err == gorm.ErrRecordNotFound {
		c.JSON(http.StatusOK, gin.H{
			"schedule":     nil,
			"org_timezone": org.Timezone,
			"state":        schedule.Evaluate(nil, time.Now()),
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load the schedule"})
		return
	}

	out := h.withPreview(&row)
	out["org_timezone"] = org.Timezone
	c.JSON(http.StatusOK, out)
}

// PutOrgSchedule handles PUT /enforcement/schedule
func (h *EnforcementHandler) PutOrgSchedule(c *gin.Context) { h.upsert(c, "org", nil, nil) }

// DeleteOrgSchedule handles DELETE /enforcement/schedule — removing it returns
// every inheriting device to continuous enforcement.
func (h *EnforcementHandler) DeleteOrgSchedule(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))
	h.db.Where("org_id = ? AND scope = 'org'", orgID).Delete(&models.EnforcementSchedule{})
	c.JSON(http.StatusOK, gin.H{"message": "Working-hours schedule removed — devices enforce continuously"})
}

// PutDeviceSchedule handles PUT /devices/:id/schedule
func (h *EnforcementHandler) PutDeviceSchedule(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))
	deviceID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid device id"})
		return
	}
	var dev models.Device
	if err := h.db.Where("id = ? AND org_id = ?", deviceID, orgID).First(&dev).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}
	h.upsert(c, "device", nil, &deviceID)
}

// DeleteDeviceSchedule handles DELETE /devices/:id/schedule — drops the
// override so the device inherits its team's or the organization's schedule.
func (h *EnforcementHandler) DeleteDeviceSchedule(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))
	deviceID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid device id"})
		return
	}
	h.db.Where("org_id = ? AND scope = 'device' AND device_id = ?", orgID, deviceID).
		Delete(&models.EnforcementSchedule{})
	c.JSON(http.StatusOK, gin.H{"message": "Override removed — this device now follows the inherited schedule"})
}

// PutTeamSchedule handles PUT /teams/:id/schedule
func (h *EnforcementHandler) PutTeamSchedule(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))
	teamID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team id"})
		return
	}
	var team models.Team
	if err := h.db.Where("id = ? AND org_id = ?", teamID, orgID).First(&team).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}
	h.upsert(c, "team", &teamID, nil)
}

// DeleteTeamSchedule handles DELETE /teams/:id/schedule
func (h *EnforcementHandler) DeleteTeamSchedule(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))
	teamID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team id"})
		return
	}
	h.db.Where("org_id = ? AND scope = 'team' AND team_id = ?", orgID, teamID).
		Delete(&models.EnforcementSchedule{})
	c.JSON(http.StatusOK, gin.H{"message": "Team schedule removed"})
}

// ListSchedules handles GET /enforcement/schedules — every schedule in the org
// with the name of what it applies to, for one overview screen.
func (h *EnforcementHandler) ListSchedules(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var rows []models.EnforcementSchedule
	h.db.Where("org_id = ?", orgID).Order("scope ASC").Find(&rows)

	now := time.Now()
	out := make([]gin.H, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		label := "All devices"
		switch r.Scope {
		case "team":
			var t models.Team
			if r.TeamID != nil && h.db.Select("name").Where("id = ?", *r.TeamID).First(&t).Error == nil {
				label = "Team: " + t.Name
			}
		case "device":
			var d models.Device
			if r.DeviceID != nil && h.db.Select("hostname").Where("id = ?", *r.DeviceID).First(&d).Error == nil {
				label = "Device: " + d.Hostname
			}
		}
		out = append(out, gin.H{"schedule": r, "applies_to": label, "state": schedule.Evaluate(r.Spec(), now)})
	}
	c.JSON(http.StatusOK, gin.H{"schedules": out, "total": len(out)})
}

// SetDeviceOwnership handles PATCH /devices/:id — company vs personal.
func (h *EnforcementHandler) SetDeviceOwnership(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var in struct {
		Ownership string `json:"ownership" binding:"required"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ownership := strings.ToLower(strings.TrimSpace(in.Ownership))
	if ownership != models.OwnershipCompany && ownership != models.OwnershipPersonal {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ownership must be 'company' or 'personal'"})
		return
	}

	res := h.db.Model(&models.Device{}).
		Where("id = ? AND org_id = ?", c.Param("id"), orgID).
		Update("ownership", ownership)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update the device"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ownership": ownership})
}

// GetDeviceEnforcement handles GET /devices/:id/enforcement — what governs this
// device right now, and where that rule came from.
func (h *EnforcementHandler) GetDeviceEnforcement(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var dev models.Device
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&dev).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	teamID := teamIDForDevice(h.db, &dev)
	resolved := resolveSchedule(h.db, orgID, &dev.ID, teamID)
	state := schedule.Evaluate(resolved.Spec(), time.Now())

	var override models.EnforcementSchedule
	hasOverride := h.db.Where("org_id = ? AND scope = 'device' AND device_id = ?", orgID, dev.ID).
		First(&override).Error == nil

	out := gin.H{
		"device_id":    dev.ID,
		"ownership":    dev.Ownership,
		"state":        state,
		"has_override": hasOverride,
		"inherited":    resolved,
	}
	if hasOverride {
		out["override"] = override
	}
	c.JSON(http.StatusOK, out)
}
