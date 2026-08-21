package handlers

import (
	"net/http"
	"strconv"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TicketHandler serves both sides of the same lightweight ticket system: an
// org user raising and following an issue (company-dashboard routes, scoped
// to their own org) and a superadmin triaging every org's tickets
// (superadmin routes, unscoped). One model, one handler, two route groups
// with different visibility — not two parallel systems to keep in sync.
type TicketHandler struct {
	db *gorm.DB
}

func NewTicketHandler(db *gorm.DB) *TicketHandler {
	return &TicketHandler{db: db}
}

type ticketEntry struct {
	models.SupportTicket
	OrgName        string `json:"org_name,omitempty"`
	CreatedByEmail string `json:"created_by_email,omitempty"`
	MessageCount   int64  `json:"message_count"`
}

func (h *TicketHandler) withDetail(tickets []models.SupportTicket) []ticketEntry {
	out := make([]ticketEntry, 0, len(tickets))
	for _, t := range tickets {
		e := ticketEntry{SupportTicket: t}
		var creator models.User
		if h.db.Select("email").First(&creator, "id = ?", t.CreatedByID).Error == nil {
			e.CreatedByEmail = creator.Email
		}
		if t.OrgID != nil {
			var org models.Organization
			if h.db.Select("name").First(&org, "id = ?", *t.OrgID).Error == nil {
				e.OrgName = org.Name
			}
		}
		h.db.Model(&models.SupportTicketMessage{}).Where("ticket_id = ?", t.ID).Count(&e.MessageCount)
		out = append(out, e)
	}
	return out
}

// ListForOrg handles GET /tickets (company-dashboard, own org only)
func (h *TicketHandler) ListForOrg(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	var tickets []models.SupportTicket
	h.db.Where("org_id = ?", orgID).Order("created_at DESC").Find(&tickets)
	c.JSON(http.StatusOK, gin.H{"tickets": h.withDetail(tickets), "total": len(tickets)})
}

// List handles GET /superadmin/tickets — every org's tickets, filterable.
func (h *TicketHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := h.db.Model(&models.SupportTicket{})
	if status := c.Query("status"); status != "" {
		q = q.Where("status = ?", status)
	}
	if orgID := c.Query("org_id"); orgID != "" {
		q = q.Where("org_id = ?", orgID)
	}
	var total int64
	q.Count(&total)

	var tickets []models.SupportTicket
	q.Order("created_at DESC").Offset((page - 1) * limit).Limit(limit).Find(&tickets)

	c.JSON(http.StatusOK, gin.H{
		"tickets": h.withDetail(tickets), "total": total, "page": page, "limit": limit,
		"pages": (total + int64(limit) - 1) / int64(limit),
	})
}

type createTicketRequest struct {
	Subject  string `json:"subject" binding:"required"`
	Body     string `json:"body" binding:"required"`
	Priority string `json:"priority"`
}

func (r *createTicketRequest) priority() models.TicketPriority {
	switch models.TicketPriority(r.Priority) {
	case models.TicketPriorityLow, models.TicketPriorityHigh, models.TicketPriorityUrgent:
		return models.TicketPriority(r.Priority)
	default:
		return models.TicketPriorityNormal
	}
}

// Create handles POST /tickets (company-dashboard) — org user raises a
// ticket, org taken from their JWT scope, never the request body.
func (h *TicketHandler) Create(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "No organization context"})
		return
	}
	h.create(c, &orgID)
}

// CreateInternal handles POST /superadmin/tickets — a superadmin opening a
// platform-level ticket (OrgID nil) for internal tracking.
func (h *TicketHandler) CreateInternal(c *gin.Context) {
	h.create(c, nil)
}

func (h *TicketHandler) create(c *gin.Context, orgID *uuid.UUID) {
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Could not identify the signed-in user"})
		return
	}
	var req createTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ticket := models.SupportTicket{
		OrgID: orgID, Subject: req.Subject, Status: models.TicketStatusOpen,
		Priority: req.priority(), CreatedByID: *uid,
	}
	if err := h.db.Create(&ticket).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create ticket"})
		return
	}
	h.db.Create(&models.SupportTicketMessage{TicketID: ticket.ID, AuthorID: *uid, Body: req.Body})

	writeAudit(h.db, c, orgID, "create", "support_ticket", &ticket.ID, map[string]any{"subject": req.Subject})
	c.JSON(http.StatusCreated, ticket)
}

type ticketDetail struct {
	models.SupportTicket
	Messages []ticketMessageEntry `json:"messages"`
}

type ticketMessageEntry struct {
	models.SupportTicketMessage
	AuthorEmail string `json:"author_email,omitempty"`
}

// getScoped loads a ticket, enforcing org ownership when scopedOrgID is
// non-empty (the company-dashboard path) and skipping that check for the
// superadmin path (scopedOrgID == "").
func (h *TicketHandler) getScoped(c *gin.Context, scopedOrgID string) (*models.SupportTicket, bool) {
	var ticket models.SupportTicket
	q := h.db.Where("id = ?", c.Param("id"))
	if scopedOrgID != "" {
		q = q.Where("org_id = ?", scopedOrgID)
	}
	if err := q.First(&ticket).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return nil, false
	}
	return &ticket, true
}

func (h *TicketHandler) get(c *gin.Context, scopedOrgID string) {
	ticket, ok := h.getScoped(c, scopedOrgID)
	if !ok {
		return
	}
	var messages []models.SupportTicketMessage
	h.db.Where("ticket_id = ?", ticket.ID).Order("created_at ASC").Find(&messages)

	entries := make([]ticketMessageEntry, 0, len(messages))
	for _, m := range messages {
		e := ticketMessageEntry{SupportTicketMessage: m}
		var author models.User
		if h.db.Select("email").First(&author, "id = ?", m.AuthorID).Error == nil {
			e.AuthorEmail = author.Email
		}
		entries = append(entries, e)
	}
	c.JSON(http.StatusOK, ticketDetail{SupportTicket: *ticket, Messages: entries})
}

// Get handles GET /tickets/:id (company-dashboard, own org only)
func (h *TicketHandler) Get(c *gin.Context) { h.get(c, c.GetString("scoped_org_id")) }

// GetAny handles GET /superadmin/tickets/:id (any org)
func (h *TicketHandler) GetAny(c *gin.Context) { h.get(c, "") }

func (h *TicketHandler) addMessage(c *gin.Context, scopedOrgID string) {
	ticket, ok := h.getScoped(c, scopedOrgID)
	if !ok {
		return
	}
	uid := currentUserID(c)
	if uid == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Could not identify the signed-in user"})
		return
	}
	var req struct {
		Body string `json:"body" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	msg := models.SupportTicketMessage{TicketID: ticket.ID, AuthorID: *uid, Body: req.Body}
	if err := h.db.Create(&msg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add message"})
		return
	}
	// A reply reopens a resolved ticket — resolution meant "no response
	// needed yet", not "this thread is locked".
	if ticket.Status == models.TicketStatusResolved || ticket.Status == models.TicketStatusClosed {
		h.db.Model(ticket).Update("status", models.TicketStatusOpen)
	}
	c.JSON(http.StatusCreated, msg)
}

// AddMessage handles POST /tickets/:id/messages (company-dashboard)
func (h *TicketHandler) AddMessage(c *gin.Context) { h.addMessage(c, c.GetString("scoped_org_id")) }

// AddMessageAny handles POST /superadmin/tickets/:id/messages
func (h *TicketHandler) AddMessageAny(c *gin.Context) { h.addMessage(c, "") }

// UpdateStatus handles PATCH /superadmin/tickets/:id — superadmin-only
// triage: status, priority, assignment. Org users don't get a status
// control; replying is how they signal "still needs attention" (see
// addMessage's reopen-on-reply above).
func (h *TicketHandler) UpdateStatus(c *gin.Context) {
	var ticket models.SupportTicket
	if err := h.db.First(&ticket, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket not found"})
		return
	}
	var req struct {
		Status       string  `json:"status"`
		Priority     string  `json:"priority"`
		AssignedToID *string `json:"assigned_to_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updates := map[string]any{}
	switch models.TicketStatus(req.Status) {
	case models.TicketStatusOpen, models.TicketStatusInProgress, models.TicketStatusResolved, models.TicketStatusClosed:
		updates["status"] = req.Status
	}
	switch models.TicketPriority(req.Priority) {
	case models.TicketPriorityLow, models.TicketPriorityNormal, models.TicketPriorityHigh, models.TicketPriorityUrgent:
		updates["priority"] = req.Priority
	}
	if req.AssignedToID != nil {
		if *req.AssignedToID == "" {
			updates["assigned_to_id"] = nil
		} else if id, err := uuid.Parse(*req.AssignedToID); err == nil {
			updates["assigned_to_id"] = id
		}
	}
	if len(updates) > 0 {
		h.db.Model(&ticket).Updates(updates)
	}
	writeAudit(h.db, c, ticket.OrgID, "update", "support_ticket", &ticket.ID, updates)
	c.JSON(http.StatusOK, ticket)
}
