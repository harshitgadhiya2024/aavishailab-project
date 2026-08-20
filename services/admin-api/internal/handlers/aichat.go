package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AIChatHandler stores the assistant's conversations. The AI service itself is
// stateless: it gets a message list, streams a reply and forgets. Anything the
// user should still see tomorrow — the thread, its title, which tools ran —
// lives here, scoped to the org and the individual admin who wrote it.
type AIChatHandler struct {
	db *gorm.DB
}

func NewAIChatHandler(db *gorm.DB) *AIChatHandler { return &AIChatHandler{db: db} }

func (h *AIChatHandler) actor(c *gin.Context) (orgID uuid.UUID, userID uuid.UUID, ok bool) {
	org, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "No organization context"})
		return uuid.Nil, uuid.Nil, false
	}
	raw, exists := c.Get(middleware.ContextKeyUserID)
	uid, cast := raw.(uuid.UUID)
	if !exists || !cast {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No user context"})
		return uuid.Nil, uuid.Nil, false
	}
	return org, uid, true
}

// sessionSummary is the list-view shape: enough to render the history sidebar
// without shipping every message of every conversation.
type sessionSummary struct {
	models.AIChatSession
	MessageCount int    `json:"message_count"`
	Preview      string `json:"preview"`
}

// ListSessions handles GET /ai/sessions
func (h *AIChatHandler) ListSessions(c *gin.Context) {
	orgID, userID, ok := h.actor(c)
	if !ok {
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	var sessions []models.AIChatSession
	h.db.Where("org_id = ? AND user_id = ?", orgID, userID).
		Order("updated_at DESC").Limit(limit).Find(&sessions)

	out := make([]sessionSummary, 0, len(sessions))
	for _, s := range sessions {
		var count int64
		h.db.Model(&models.AIChatMessage{}).Where("session_id = ?", s.ID).Count(&count)

		// The first thing the user asked reads better in a list than the
		// assistant's opening greeting, which is identical in every thread.
		var first models.AIChatMessage
		preview := ""
		if err := h.db.Where("session_id = ? AND role = ?", s.ID, "user").
			Order("created_at ASC").First(&first).Error; err == nil {
			preview = first.Content
			if len(preview) > 120 {
				preview = preview[:120] + "…"
			}
		}
		out = append(out, sessionSummary{AIChatSession: s, MessageCount: int(count), Preview: preview})
	}

	c.JSON(http.StatusOK, gin.H{"data": out, "total": len(out)})
}

// CreateSession handles POST /ai/sessions
func (h *AIChatHandler) CreateSession(c *gin.Context) {
	orgID, userID, ok := h.actor(c)
	if !ok {
		return
	}

	var req struct {
		Title string `json:"title"`
		Model string `json:"model"`
	}
	_ = c.ShouldBindJSON(&req)

	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "New chat"
	}

	session := models.AIChatSession{
		OrgID:  orgID,
		UserID: userID,
		Title:  title,
		Model:  req.Model,
	}
	if err := h.db.Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create conversation"})
		return
	}
	c.JSON(http.StatusCreated, session)
}

// GetSession handles GET /ai/sessions/:id — the conversation with its messages.
func (h *AIChatHandler) GetSession(c *gin.Context) {
	orgID, userID, ok := h.actor(c)
	if !ok {
		return
	}

	var session models.AIChatSession
	if err := h.db.Where("id = ? AND org_id = ? AND user_id = ?", c.Param("id"), orgID, userID).
		First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	var messages []models.AIChatMessage
	h.db.Where("session_id = ?", session.ID).Order("created_at ASC").Find(&messages)

	c.JSON(http.StatusOK, gin.H{"session": session, "messages": messages})
}

// UpdateSession handles PATCH /ai/sessions/:id — rename.
func (h *AIChatHandler) UpdateSession(c *gin.Context) {
	orgID, userID, ok := h.actor(c)
	if !ok {
		return
	}

	var session models.AIChatSession
	if err := h.db.Where("id = ? AND org_id = ? AND user_id = ?", c.Param("id"), orgID, userID).
		First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	var req struct {
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Title cannot be empty"})
		return
	}
	if len(title) > 120 {
		title = title[:120]
	}

	h.db.Model(&session).Update("title", title)
	session.Title = title
	c.JSON(http.StatusOK, session)
}

// DeleteSession handles DELETE /ai/sessions/:id
func (h *AIChatHandler) DeleteSession(c *gin.Context) {
	orgID, userID, ok := h.actor(c)
	if !ok {
		return
	}

	var session models.AIChatSession
	if err := h.db.Where("id = ? AND org_id = ? AND user_id = ?", c.Param("id"), orgID, userID).
		First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	// Messages have no soft-delete of their own; removing them with the thread
	// keeps orphan rows from accumulating behind a deleted conversation.
	h.db.Where("session_id = ?", session.ID).Delete(&models.AIChatMessage{})
	h.db.Delete(&session)

	c.JSON(http.StatusOK, gin.H{"message": "Conversation deleted"})
}

// AddMessage handles POST /ai/sessions/:id/messages
func (h *AIChatHandler) AddMessage(c *gin.Context) {
	orgID, userID, ok := h.actor(c)
	if !ok {
		return
	}

	var session models.AIChatSession
	if err := h.db.Where("id = ? AND org_id = ? AND user_id = ?", c.Param("id"), orgID, userID).
		First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	var req struct {
		Role       string         `json:"role" binding:"required"`
		Content    string         `json:"content"`
		ToolName   string         `json:"tool_name"`
		ToolCalls  map[string]any `json:"tool_calls"`
		TokensUsed int            `json:"tokens_used"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Role != "user" && req.Role != "assistant" && req.Role != "tool" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role must be user, assistant or tool"})
		return
	}

	msg := models.AIChatMessage{
		SessionID:  session.ID,
		Role:       req.Role,
		Content:    req.Content,
		ToolName:   req.ToolName,
		ToolCalls:  req.ToolCalls,
		TokensUsed: req.TokensUsed,
	}
	if err := h.db.Create(&msg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store message"})
		return
	}

	// First real question names the thread — an untitled list of "New chat"
	// rows is useless for finding anything later.
	if req.Role == "user" && (session.Title == "" || session.Title == "New chat") {
		title := strings.TrimSpace(req.Content)
		if len(title) > 60 {
			title = title[:60] + "…"
		}
		if title != "" {
			h.db.Model(&session).Update("title", title)
		}
	} else {
		// Touch the thread so the sidebar sorts by real activity.
		h.db.Model(&session).Update("updated_at", gorm.Expr("NOW()"))
	}

	c.JSON(http.StatusCreated, msg)
}
