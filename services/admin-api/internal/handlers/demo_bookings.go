package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"
	_ "time/tzdata" // slot times are shown in the customer's own time zone

	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Demos run in the team's hours, India time: 30-minute slots, Monday to
// Friday, first call at 10:00 and last at 17:30, booked up to 30 days out.
const (
	demoTeamZone     = "Asia/Kolkata"
	demoFirstSlotMin = 10 * 60
	demoLastSlotMin  = 17*60 + 30
	demoMaxDaysAhead = 30
)

// DemoBookingHandler lets a signed-in company admin book a demo slot from
// the console. Bookings are demo requests (the same list superadmin works
// through), with the organization and the chosen time attached.
type DemoBookingHandler struct {
	db *gorm.DB
}

func NewDemoBookingHandler(db *gorm.DB) *DemoBookingHandler {
	return &DemoBookingHandler{db: db}
}

func (h *DemoBookingHandler) upcoming(orgID uuid.UUID) (*models.DemoRequest, bool) {
	var b models.DemoRequest
	err := h.db.Where("org_id = ? AND preferred_at > ? AND status <> ?", orgID, time.Now(), models.DemoRequestClosed).
		Order("preferred_at ASC").First(&b).Error
	return &b, err == nil
}

// Get handles GET /demo-booking: this organization's upcoming demo, if any,
// and the slots already taken in the booking window, so the picker can
// grey them out.
func (h *DemoBookingHandler) Get(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No organization in scope"})
		return
	}
	now := time.Now()
	taken := []time.Time{}
	h.db.Model(&models.DemoRequest{}).
		Where("preferred_at BETWEEN ? AND ? AND status <> ? AND (org_id IS NULL OR org_id <> ?)", now, now.AddDate(0, 0, demoMaxDaysAhead+1), models.DemoRequestClosed, orgID).
		Pluck("preferred_at", &taken)

	resp := gin.H{"booking": nil, "taken": taken, "team_zone": demoTeamZone}
	if b, ok := h.upcoming(orgID); ok {
		resp["booking"] = b
	}
	c.JSON(http.StatusOK, resp)
}

// Book handles POST /demo-booking. A company with a demo already booked
// moves it to the new slot rather than booking a second one.
func (h *DemoBookingHandler) Book(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No organization in scope"})
		return
	}
	var req struct {
		PreferredAt time.Time `json:"preferred_at" binding:"required"`
		Timezone    string    `json:"timezone" binding:"max=64"`
		Phone       string    `json:"phone" binding:"max=40"`
		Devices     string    `json:"devices" binding:"max=50"`
		Topics      []string  `json:"topics" binding:"max=10"`
		Message     string    `json:"message" binding:"max=2000"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	slot := req.PreferredAt.UTC().Truncate(time.Minute)
	if msg := checkDemoSlot(slot, time.Now()); msg != "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": msg})
		return
	}
	var clash int64
	h.db.Model(&models.DemoRequest{}).
		Where("preferred_at = ? AND status <> ? AND (org_id IS NULL OR org_id <> ?)", slot, models.DemoRequestClosed, orgID).
		Count(&clash)
	if clash > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "That time was just taken. Please pick another slot."})
		return
	}

	uid := currentUserID(c)
	var user models.User
	if uid == nil || h.db.First(&user, "id = ?", *uid).Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Sign in again to book a demo"})
		return
	}
	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	loc, err := time.LoadLocation(strings.TrimSpace(req.Timezone))
	if err != nil || req.Timezone == "" {
		loc, _ = time.LoadLocation(demoTeamZone)
	}
	topics := []string{}
	for _, t := range req.Topics {
		if t = clip(t, 60); t != "" {
			topics = append(topics, t)
		}
	}

	b, exists := h.upcoming(orgID)
	if !exists {
		b = &models.DemoRequest{OrgID: &orgID, Status: models.DemoRequestNew}
	}
	b.Name = clip(user.FullName(), 200)
	b.Email = strings.ToLower(user.Email)
	b.Company = clip(org.Name, 200)
	b.Devices = clip(req.Devices, 50)
	b.Message = clip(req.Message, 2000)
	b.Source = "Console booking"
	b.Phone = clip(req.Phone, 40)
	b.Topics = topics
	b.PreferredAt = &slot
	b.Timezone = loc.String()
	b.IPAddress = clip(c.ClientIP(), 64)
	b.UserAgent = clip(c.Request.UserAgent(), 500)
	if err := h.db.Save(b).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save your booking"})
		return
	}

	when := slot.In(loc).Format("Monday, 2 January 2006 at 3:04 PM") + " (" + loc.String() + ")"
	teamLoc, _ := time.LoadLocation(demoTeamZone)
	teamWhen := slot.In(teamLoc).Format("Mon 2 Jan, 3:04 PM") + " IST"
	note := fmt.Sprintf("Booked for %s (customer's time: %s).", teamWhen, when)
	if exists {
		note = "Rescheduled. " + note
	}
	if len(topics) > 0 {
		note += "\nTopics: " + strings.Join(topics, ", ")
	}
	if b.Phone != "" {
		note += "\nPhone: " + b.Phone
	}
	if b.Message != "" {
		note += "\n\n" + b.Message
	}
	mailer.DemoRequestReceived(teamRecipients(h.db, "LEADS_NOTIFY_EMAIL"), b.Name, b.Email, b.Company, b.Devices, note, "Console booking")
	mailer.DemoBookedConfirmation(b.Email, user.FirstName, when)

	writeAudit(h.db, c, &orgID, "create", "demo_request", &b.ID, map[string]any{"preferred_at": slot, "rescheduled": exists})
	c.JSON(http.StatusCreated, gin.H{"booking": b, "when": when})
}

// checkDemoSlot explains why a slot can't be booked, or returns "".
func checkDemoSlot(slot, now time.Time) string {
	if slot.Before(now.Add(time.Hour)) {
		return "Please pick a time at least an hour from now."
	}
	if slot.After(now.AddDate(0, 0, demoMaxDaysAhead)) {
		return fmt.Sprintf("Please pick a time within the next %d days.", demoMaxDaysAhead)
	}
	loc, _ := time.LoadLocation(demoTeamZone)
	t := slot.In(loc)
	mins := t.Hour()*60 + t.Minute()
	if t.Weekday() == time.Saturday || t.Weekday() == time.Sunday || mins < demoFirstSlotMin || mins > demoLastSlotMin || t.Minute()%30 != 0 {
		return "Demos run Monday to Friday, 10:00 to 18:00 India time, in 30-minute slots."
	}
	return ""
}
