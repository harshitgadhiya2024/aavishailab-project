package handlers

import (
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// The employee portal's bell. Two sources, merged at read time:
//
//   - employee_notifications rows, written when something happens to the
//     employee in the control plane (access request decided, device enrolled
//     or revoked, password changed);
//   - their recent blocked/alerted activity, read from the company's data
//     plane and never copied out of it.
//
// Read state is per row for the first and a "seen up to" mark for the second.

const (
	notifFeedDays     = 30 // how far back the bell looks
	notifFeedLimit    = 30 // items returned
	notifActivityDays = 7  // activity is noisy; only the recent week
	notifKeepDays     = 90 // stored rows older than this are pruned
)

// Notification kinds the portal knows how to draw.
const (
	NotifAccessApproved  = "access_approved"
	NotifAccessDenied    = "access_denied"
	NotifAccessRevoked   = "access_revoked"
	NotifDeviceEnrolled  = "device_enrolled"
	NotifDeviceRevoked   = "device_revoked"
	NotifPasswordChanged = "password_changed"
	NotifBlocked         = "blocked"
	NotifAlerted         = "alerted"
)

var notificationHub *WebSocketHub

// UseNotificationHub lets notifyEmployee push to open portal tabs as well as
// storing the notification.
func UseNotificationHub(h *WebSocketHub) { notificationHub = h }

// notifyEmployee records a notification for one employee and pushes it to
// their open portal tabs. Best effort: a failure here is logged and never
// fails the action that caused it.
func notifyEmployee(db *gorm.DB, orgID, employeeID uuid.UUID, kind, title, body, link string) {
	if db == nil || employeeID == uuid.Nil {
		return
	}
	n := models.EmployeeNotification{
		OrgID: orgID, EmployeeID: employeeID, Kind: kind,
		Title: truncateRunes(strings.TrimSpace(title), 200), Body: truncateRunes(strings.TrimSpace(body), 500), Link: link,
		CreatedAt: time.Now(),
	}
	if err := db.Create(&n).Error; err != nil {
		log.Printf("notify employee %s: %v", employeeID, err)
		return
	}
	db.Where("employee_id = ? AND created_at < ?", employeeID, time.Now().AddDate(0, 0, -notifKeepDays)).
		Delete(&models.EmployeeNotification{})
	if notificationHub != nil {
		notificationHub.SendToEmployee(orgID, employeeID, "notification", n)
	}
}

type portalNotification struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Link      string    `json:"link"`
	CreatedAt time.Time `json:"created_at"`
	Read      bool      `json:"read"`
}

// Notifications handles GET /api/v1/portal/notifications.
func (h *PortalHandler) Notifications(c *gin.Context) {
	emp, ok := h.activePortalEmployee(c)
	if !ok {
		return
	}
	c.Header("Cache-Control", "no-store")
	now := time.Now()

	var state models.EmployeeNotificationState
	h.db.Where("employee_id = ?", emp.ID).Limit(1).Find(&state)

	var rows []models.EmployeeNotification
	if err := h.db.Where("employee_id = ? AND org_id = ? AND created_at >= ?", emp.ID, emp.OrgID, now.AddDate(0, 0, -notifFeedDays)).
		Order("created_at DESC").Limit(notifFeedLimit).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load notifications"})
		return
	}
	var unreadStored int64
	h.db.Model(&models.EmployeeNotification{}).
		Where("employee_id = ? AND org_id = ? AND read_at IS NULL AND created_at >= ?", emp.ID, emp.OrgID, now.AddDate(0, 0, -notifFeedDays)).
		Count(&unreadStored)

	items := make([]portalNotification, 0, len(rows)+notifFeedLimit)
	for _, r := range rows {
		items = append(items, portalNotification{
			ID: r.ID.String(), Kind: r.Kind, Title: r.Title, Body: r.Body, Link: r.Link,
			CreatedAt: r.CreatedAt, Read: r.ReadAt != nil,
		})
	}

	// Activity from the data plane. If the company's store is down the bell
	// still works — it just says activity couldn't be checked.
	activityOK := true
	var unreadActivity int64
	if st, err := dataplane.EventsFor(c.Request.Context(), emp.OrgID.String()); err != nil {
		activityOK = false
	} else {
		q := dataplane.EventQuery{
			OrgID: emp.OrgID, EmployeeID: &emp.ID,
			Actions: dataplane.Strings(models.EventActionBlocked, models.EventActionAlerted),
			Since:   now.AddDate(0, 0, -notifActivityDays),
			Limit:   notifFeedLimit,
		}
		events, err := st.FindEvents(c.Request.Context(), q)
		if err != nil {
			activityOK = false
		} else {
			attachTargetApps(c.Request.Context(), emp.OrgID.String(), events)
			for i := range events {
				items = append(items, activityNotification(&events[i], state.SeenAt))
			}
			unseen := q
			unseen.Limit = 0
			if state.SeenAt.After(unseen.Since) {
				unseen.Since = state.SeenAt.Add(time.Microsecond)
			}
			if n, err := st.CountEvents(c.Request.Context(), unseen); err == nil {
				unreadActivity = n
			}
		}
	}

	sort.SliceStable(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	if len(items) > notifFeedLimit {
		items = items[:notifFeedLimit]
	}
	c.JSON(http.StatusOK, gin.H{
		"items":       items,
		"unread":      unreadStored + unreadActivity,
		"activity_ok": activityOK,
	})
}

func activityNotification(ev *models.ActivityEvent, seenAt time.Time) portalNotification {
	target := firstNonEmpty(ev.TargetApp, ev.TargetDomain, ev.Target, "a website or app")
	kind, title, link := NotifAlerted, "Flagged: "+target, "/dashboard/activity?action=alerted"
	if ev.Action == models.EventActionBlocked {
		kind, title, link = NotifBlocked, "Blocked: "+target, "/dashboard/activity?action=blocked"
	}
	body := "By your company's security policy"
	if ev.PolicyName != "" {
		body = "Policy: " + ev.PolicyName
	}
	return portalNotification{
		ID: "ev-" + ev.ID.String(), Kind: kind, Title: truncateRunes(title, 200), Body: body, Link: link,
		CreatedAt: ev.Timestamp, Read: !ev.Timestamp.After(seenAt),
	}
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

// MarkNotificationsRead handles POST /api/v1/portal/notifications/read —
// everything up to now, stored and activity alike.
func (h *PortalHandler) MarkNotificationsRead(c *gin.Context) {
	emp, ok := h.activePortalEmployee(c)
	if !ok {
		return
	}
	now := time.Now()
	h.db.Model(&models.EmployeeNotification{}).
		Where("employee_id = ? AND org_id = ? AND read_at IS NULL", emp.ID, emp.OrgID).
		Update("read_at", now)
	h.db.Save(&models.EmployeeNotificationState{EmployeeID: emp.ID, SeenAt: now})
	c.JSON(http.StatusOK, gin.H{"unread": 0, "seen_at": now})
}

// MarkNotificationRead handles POST /api/v1/portal/notifications/:id/read.
func (h *PortalHandler) MarkNotificationRead(c *gin.Context) {
	emp, ok := h.activePortalEmployee(c)
	if !ok {
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Notification not found"})
		return
	}
	res := h.db.Model(&models.EmployeeNotification{}).
		Where("id = ? AND employee_id = ? AND org_id = ? AND read_at IS NULL", id, emp.ID, emp.OrgID).
		Update("read_at", time.Now())
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not update the notification"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}
