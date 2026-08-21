package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// currentUserID reads the acting user's id off the request context — set by
// AuthRequired for every authenticated route, superadmin included.
func currentUserID(c *gin.Context) *uuid.UUID {
	raw, ok := c.Get(middleware.ContextKeyUserID)
	if !ok {
		return nil
	}
	id, ok := raw.(uuid.UUID)
	if !ok {
		return nil
	}
	return &id
}

// writeAudit records one accountability row for a mutating action. orgID is
// nil for platform-level actions that aren't scoped to a single
// organization (agent-package publish/rollback, catalog edits, team
// management) — AuditLog.OrgID already allows that for exactly this reason.
func writeAudit(db *gorm.DB, c *gin.Context, orgID *uuid.UUID, action, resource string, resourceID *uuid.UUID, changes map[string]any) {
	if db == nil {
		return
	}
	db.Create(&models.AuditLog{
		OrgID:      orgID,
		UserID:     currentUserID(c),
		Action:     action,
		Resource:   resource,
		ResourceID: resourceID,
		Changes:    changes,
		IPAddress:  c.ClientIP(),
		UserAgent:  c.GetHeader("User-Agent"),
	})
}

// AuditHandler serves the superadmin-facing view of models.AuditLog — the
// table every mutating handler already writes to (policies, employees,
// access requests, and now every superadmin action) but that, before this,
// had no reader anywhere in the codebase.
type AuditHandler struct {
	db *gorm.DB
}

func NewAuditHandler(db *gorm.DB) *AuditHandler { return &AuditHandler{db: db} }

type auditLogEntry struct {
	models.AuditLog
	ActorEmail string `json:"actor_email,omitempty"`
	ActorName  string `json:"actor_name,omitempty"`
	OrgName    string `json:"org_name,omitempty"`
}

// List handles GET /superadmin/audit-log — filterable, paginated, newest
// first. Actor and org names are resolved with two batch lookups rather than
// a SQL join so this stays correct even for rows whose user or org has since
// been deleted (UserID/OrgID are nullable exactly for that reason).
func (h *AuditHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	q := h.db.Model(&models.AuditLog{})
	if action := c.Query("action"); action != "" {
		q = q.Where("action = ?", action)
	}
	if resource := c.Query("resource"); resource != "" {
		q = q.Where("resource = ?", resource)
	}
	if orgID := c.Query("org_id"); orgID != "" {
		q = q.Where("org_id = ?", orgID)
	}
	if actorID := c.Query("actor_id"); actorID != "" {
		q = q.Where("user_id = ?", actorID)
	}
	if from := c.Query("from"); from != "" {
		if t, err := time.Parse("2006-01-02", from); err == nil {
			q = q.Where("created_at >= ?", t)
		}
	}
	if to := c.Query("to"); to != "" {
		if t, err := time.Parse("2006-01-02", to); err == nil {
			q = q.Where("created_at < ?", t.Add(24*time.Hour))
		}
	}

	var total int64
	q.Count(&total)

	var logs []models.AuditLog
	q.Order("created_at DESC").Offset((page - 1) * limit).Limit(limit).Find(&logs)

	userIDs := make([]uuid.UUID, 0, len(logs))
	orgIDs := make([]uuid.UUID, 0, len(logs))
	for _, l := range logs {
		if l.UserID != nil {
			userIDs = append(userIDs, *l.UserID)
		}
		if l.OrgID != nil {
			orgIDs = append(orgIDs, *l.OrgID)
		}
	}

	users := map[uuid.UUID]models.User{}
	if len(userIDs) > 0 {
		var rows []models.User
		h.db.Where("id IN ?", userIDs).Find(&rows)
		for _, u := range rows {
			users[u.ID] = u
		}
	}
	orgs := map[uuid.UUID]string{}
	if len(orgIDs) > 0 {
		var rows []models.Organization
		h.db.Select("id, name").Where("id IN ?", orgIDs).Find(&rows)
		for _, o := range rows {
			orgs[o.ID] = o.Name
		}
	}

	out := make([]auditLogEntry, 0, len(logs))
	for _, l := range logs {
		e := auditLogEntry{AuditLog: l}
		if l.UserID != nil {
			if u, ok := users[*l.UserID]; ok {
				e.ActorEmail = u.Email
				e.ActorName = u.FullName()
			}
		}
		if l.OrgID != nil {
			e.OrgName = orgs[*l.OrgID]
		}
		out = append(out, e)
	}

	c.JSON(http.StatusOK, gin.H{
		"entries": out,
		"total":   total,
		"page":    page,
		"limit":   limit,
		"pages":   (total + int64(limit) - 1) / int64(limit),
	})
}
