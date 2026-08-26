package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
)

// Device-lifecycle reporting: connect, disconnect and uninstall.
//
// These are the three moments a device's protection starts or stops, so each
// one is written to activity_events (which is what the company's Devices
// activity view reads) and emailed to the org's admins. Uninstall additionally
// requires a company administrator's password — the employee cannot remove the
// connector on their own.

// deviceLifecycleContext resolves the names both the event row and the email
// need, in one place so the three handlers below can't drift apart.
type deviceLifecycleContext struct {
	Device       models.Device
	OrgName      string
	EmployeeName string
	AdminEmails  []string
}

func loadDeviceLifecycleContext(db *gorm.DB, deviceID, orgID uuid.UUID) (deviceLifecycleContext, bool) {
	var ctx deviceLifecycleContext
	if err := db.Where("id = ? AND org_id = ?", deviceID, orgID).First(&ctx.Device).Error; err != nil {
		return ctx, false
	}

	db.Model(&models.Organization{}).Where("id = ?", orgID).Pluck("name", &ctx.OrgName)

	ctx.EmployeeName = "An employee"
	if ctx.Device.EmployeeID != nil {
		var emp models.Employee
		if db.Select("first_name", "last_name").Where("id = ?", *ctx.Device.EmployeeID).
			First(&emp).Error == nil {
			if n := strings.TrimSpace(emp.FirstName + " " + emp.LastName); n != "" {
				ctx.EmployeeName = n
			}
		}
	}

	var admins []models.User
	db.Where("org_id = ? AND status = ? AND role IN ?", orgID, models.StatusActive,
		[]models.UserRole{models.RoleOrgAdmin, models.RoleAnalyst}).Find(&admins)
	for _, u := range admins {
		if u.Email != "" {
			ctx.AdminEmails = append(ctx.AdminEmails, u.Email)
		}
	}
	return ctx, true
}

// recordDeviceLifecycleEvent writes the row the dashboard's activity view
// reads. Target carries the hostname so the event reads sensibly even if the
// device row is later deleted.
func recordDeviceLifecycleEvent(db *gorm.DB, ctx deviceLifecycleContext,
	eventType models.EventType, operation string) {
	db.Create(&models.ActivityEvent{
		OrgID:      ctx.Device.OrgID,
		EmployeeID: ctx.Device.EmployeeID,
		DeviceID:   &ctx.Device.ID,
		EventType:  eventType,
		Action:     models.EventActionLogged,
		Target:     ctx.Device.Hostname,
		Operation:  operation,
		Category:   "device",
		Timestamp:  time.Now(),
	})
}

// ReportDeviceConnected handles POST /internal/agent/lifecycle/connected —
// called by the agent right after a successful enrollment or reconnect.
func (h *AgentHandler) ReportDeviceConnected(c *gin.Context) {
	deviceID, orgID, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	ctx, ok := loadDeviceLifecycleContext(h.db, deviceID, orgID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	recordDeviceLifecycleEvent(h.db, ctx, models.EventTypeDeviceConnect, "Connector connected")
	go mailer.DeviceConnected(ctx.AdminEmails, ctx.OrgName, ctx.EmployeeName,
		ctx.Device.Hostname, time.Now().Format("2 Jan 2006, 15:04"))

	c.JSON(http.StatusOK, gin.H{"status": "recorded"})
}

// ReportDeviceDisconnected handles POST /internal/agent/lifecycle/disconnected.
//
// Disconnecting is allowed — the employee owns that choice on their own
// machine — but it ends protection, so the company is told rather than the
// action being blocked. The device is marked offline in the same step so the
// dashboard doesn't wait for a heartbeat that will never come.
func (h *AgentHandler) ReportDeviceDisconnected(c *gin.Context) {
	deviceID, orgID, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	ctx, ok := loadDeviceLifecycleContext(h.db, deviceID, orgID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	h.db.Model(&models.Device{}).Where("id = ?", deviceID).Update("status", "offline")
	recordDeviceLifecycleEvent(h.db, ctx, models.EventTypeDeviceDisconnect, "Connector disconnected")
	go mailer.DeviceDisconnected(ctx.AdminEmails, ctx.OrgName, ctx.EmployeeName,
		ctx.Device.Hostname, time.Now().Format("2 Jan 2006, 15:04"))

	c.JSON(http.StatusOK, gin.H{"status": "recorded"})
}

// AuthorizeUninstall handles POST /internal/agent/lifecycle/authorize-uninstall.
//
// Removing the connector is a company decision, not the employee's, so the
// agent collects an administrator's credentials and this verifies them. Only
// an org_admin of *this device's own organization* can approve, so one
// company's admin can't authorise removal at another.
//
// Rate-limited at the route (see router.go): this endpoint accepts a password,
// and an unthrottled one on an employee's machine is a brute-force oracle.
func (h *AgentHandler) AuthorizeUninstall(c *gin.Context) {
	deviceID, orgID, _ := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}

	var req struct {
		Email    string `json:"email" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email and password are required"})
		return
	}

	ctx, ok := loadDeviceLifecycleContext(h.db, deviceID, orgID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	var admin models.User
	err := h.db.Where("LOWER(email) = LOWER(?) AND org_id = ? AND status = ? AND role = ?",
		strings.TrimSpace(req.Email), orgID, models.StatusActive, models.RoleOrgAdmin).
		First(&admin).Error

	// One message for "no such admin" and "wrong password" alike: telling them
	// apart would let anyone on the machine enumerate which addresses are
	// administrators of this company.
	const denied = "Those administrator credentials were not accepted."
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": denied})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": denied})
		return
	}

	approvedBy := strings.TrimSpace(admin.FirstName + " " + admin.LastName)
	if approvedBy == "" {
		approvedBy = admin.Email
	}

	recordDeviceLifecycleEvent(h.db, ctx, models.EventTypeDeviceUninstall,
		"Connector uninstalled (approved by "+approvedBy+")")
	h.db.Model(&models.Device{}).Where("id = ?", deviceID).Update("status", "offline")

	writeAudit(h.db, c, &orgID, "device.uninstall_authorized", "device", &deviceID,
		map[string]any{"hostname": ctx.Device.Hostname, "approved_by": admin.Email})

	go mailer.DeviceUninstalled(ctx.AdminEmails, ctx.OrgName, ctx.EmployeeName,
		ctx.Device.Hostname, approvedBy, time.Now().Format("2 Jan 2006, 15:04"))

	c.JSON(http.StatusOK, gin.H{"authorized": true, "approved_by": approvedBy})
}

// ListDeviceActivity handles GET /devices/activity — the connect / disconnect /
// uninstall trail the company sees, newest first.
//
// Separate from the main activity feed on purpose: that one is web traffic,
// keyed on domain and risk score, and these events have neither. What matters
// here is only who, what, and when.
func (h *AgentHandler) ListDeviceActivity(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid organization"})
		return
	}

	limit := 50
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}

	var events []models.ActivityEvent
	h.db.Where("org_id = ? AND event_type IN ?", orgID, []models.EventType{
		models.EventTypeDeviceConnect,
		models.EventTypeDeviceDisconnect,
		models.EventTypeDeviceUninstall,
	}).Order("timestamp DESC").Limit(limit).Find(&events)

	// Employee names in one query rather than per row.
	ids := make([]uuid.UUID, 0, len(events))
	for _, e := range events {
		if e.EmployeeID != nil {
			ids = append(ids, *e.EmployeeID)
		}
	}
	names := map[uuid.UUID]string{}
	if len(ids) > 0 {
		var emps []models.Employee
		h.db.Select("id", "first_name", "last_name", "email").Where("id IN ?", ids).Find(&emps)
		for _, e := range emps {
			n := strings.TrimSpace(e.FirstName + " " + e.LastName)
			if n == "" {
				n = e.Email
			}
			names[e.ID] = n
		}
	}

	labels := map[models.EventType]string{
		models.EventTypeDeviceConnect:    "Connected",
		models.EventTypeDeviceDisconnect: "Disconnected",
		models.EventTypeDeviceUninstall:  "Uninstalled",
	}

	rows := make([]gin.H, 0, len(events))
	for _, e := range events {
		name := "Unassigned"
		if e.EmployeeID != nil {
			if n, ok := names[*e.EmployeeID]; ok && n != "" {
				name = n
			}
		}
		rows = append(rows, gin.H{
			"id":         e.ID,
			"employee":   name,
			"event":      labels[e.EventType],
			"event_type": e.EventType,
			"hostname":   e.Target,
			"detail":     e.Operation,
			"timestamp":  e.Timestamp,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": len(rows)})
}
