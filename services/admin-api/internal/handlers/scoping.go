package handlers

import (
	"github.com/aavishield/admin-api/internal/middleware"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// scopedTeamIDs returns the teams the caller is limited to, or nil for "the
// whole organization".
//
// Only a manager is narrowed this way, and only when they actually have team
// assignments — a manager with none would otherwise silently see nothing,
// which reads as a broken dashboard rather than a permissions decision.
func scopedTeamIDs(db *gorm.DB, c *gin.Context) []uuid.UUID {
	raw, _ := c.Get(middleware.ContextKeyRole)
	role, ok := raw.(models.UserRole)
	if !ok {
		if s, isStr := raw.(string); isStr {
			role = models.UserRole(s)
		}
	}
	if role != models.RoleManager {
		return nil
	}

	userIDRaw, exists := c.Get(middleware.ContextKeyUserID)
	userID, cast := userIDRaw.(uuid.UUID)
	if !exists || !cast {
		return nil
	}

	var links []models.UserTeam
	db.Where("user_id = ?", userID).Find(&links)
	if len(links) == 0 {
		return nil
	}

	ids := make([]uuid.UUID, 0, len(links))
	for _, l := range links {
		ids = append(ids, l.TeamID)
	}
	return ids
}

// applyTeamScope narrows a query on a table that has a team_id column.
func applyTeamScope(db *gorm.DB, c *gin.Context, q *gorm.DB) *gorm.DB {
	if ids := scopedTeamIDs(db, c); ids != nil {
		return q.Where("team_id IN ?", ids)
	}
	return q
}

// applyEmployeeTeamScope narrows a query on a table that references employees
// (activity events, devices) rather than carrying team_id itself.
func applyEmployeeTeamScope(db *gorm.DB, c *gin.Context, q *gorm.DB, employeeColumn string) *gorm.DB {
	ids := scopedTeamIDs(db, c)
	if ids == nil {
		return q
	}
	return q.Where(employeeColumn+" IN (?)",
		db.Model(&models.Employee{}).Select("id").Where("team_id IN ?", ids))
}
