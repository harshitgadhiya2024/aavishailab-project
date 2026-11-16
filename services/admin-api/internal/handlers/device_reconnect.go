package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
)

// reconnectLinkCooldown stops an admin (or a double click) emailing the same
// employee about the same device over and over.
const reconnectLinkCooldown = 2 * time.Minute

// SendReconnectLink handles POST /devices/:id/reconnect-link — asks the
// employee a revoked device belongs to to reconnect it, by email and in the
// employee portal. Reconnecting itself happens on the device (the agent's
// Reconnect button, then a portal sign-in); the server recognises the machine
// and brings back this same device record.
func (h *AgentHandler) SendReconnectLink(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	var device models.Device
	if err := h.db.Where("id = ? AND org_id = ?", c.Param("id"), orgID).First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}
	if device.Status != "revoked" {
		c.JSON(http.StatusConflict, gin.H{"error": "This device is still connected."})
		return
	}
	if device.EmployeeID == nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "This device isn't assigned to an employee, so there's nobody to send the link to. Reinstall Aavishield on it instead."})
		return
	}
	var emp models.Employee
	if err := h.db.First(&emp, "id = ? AND org_id = ?", *device.EmployeeID, orgID).Error; err != nil || emp.Email == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "The employee for this device no longer exists."})
		return
	}

	now := time.Now()
	if raw, ok := device.Metadata["reconnect_link_sent_at"].(string); ok {
		if last, err := time.Parse(time.RFC3339, raw); err == nil && now.Sub(last) < reconnectLinkCooldown {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "A reconnect link was just sent. Please wait a couple of minutes before sending another."})
			return
		}
	}
	if device.Metadata == nil {
		device.Metadata = map[string]any{}
	}
	device.Metadata["reconnect_link_sent_at"] = now.UTC().Format(time.RFC3339)
	h.db.Model(&device).Update("metadata", device.Metadata)

	var org models.Organization
	h.db.Select("id", "name").First(&org, "id = ?", device.OrgID)
	orgName := org.Name
	if orgName == "" {
		orgName = "Your company"
	}

	mailer.DeviceReconnect(emp.Email, emp.FirstName, orgName, device.Hostname)
	notifyEmployee(h.db, device.OrgID, emp.ID, NotifDeviceRevoked,
		"Please reconnect "+device.Hostname,
		"Your IT administrator asked you to reconnect this device. Open the Aavishield app on it and click Reconnect.",
		"/dashboard/devices")

	oid, _ := uuid.Parse(orgID)
	writeAudit(h.db, c, &oid, "reconnect_link", "device", &device.ID, map[string]any{"employee": emp.Email})
	c.JSON(http.StatusOK, gin.H{"sent": true, "email": emp.Email})
}
