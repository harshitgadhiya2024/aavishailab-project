package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/aavishield/admin-api/internal/dataplane"
	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Employee data — activity, sessions, screenshots — is read and written
// through the dataplane package, never through h.db: for a company with data
// residency on, it lives in that company's own database. These helpers keep
// the handlers short.

// eventStore returns the store holding the request's org's employee data, or
// writes a 503 explaining that the company's own database is unreachable.
func eventStore(c *gin.Context, orgID string) (dataplane.Store, bool) {
	st, err := dataplane.EventsFor(c.Request.Context(), orgID)
	if err != nil {
		respondStoreError(c, err)
		return nil, false
	}
	return st, true
}

// respondStoreError answers a failed store call. An unreachable company store
// is the company's to fix, and the page says so instead of pretending there is
// simply no data.
func respondStoreError(c *gin.Context, err error) {
	if errors.Is(err, dataplane.ErrUnavailable) {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":      "Your company's database or file storage can't be reached right now. Check its status under Settings → Data residency.",
			"code":       "data_store_unavailable",
			"data_store": "company",
		})
		return
	}
	log.Printf("data store error: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load this data"})
}

// orgUUID parses the scoped org ID.
func orgUUID(c *gin.Context) uuid.UUID {
	id, _ := uuid.Parse(c.GetString("scoped_org_id"))
	return id
}

// teamEmployeeScope is applyEmployeeTeamScope for queries that run outside
// Aavishield's database: the manager's team members as an explicit list,
// since a company's database can't sub-select from our employees table.
func teamEmployeeScope(db *gorm.DB, c *gin.Context, q *dataplane.EventQuery) {
	teams := scopedTeamIDs(db, c)
	if teams == nil {
		return
	}
	var ids []uuid.UUID
	db.Model(&models.Employee{}).Where("team_id IN ?", teams).Pluck("id", &ids)
	q.RestrictEmployees = true
	q.EmployeeIn = ids
}

// recordAndBroadcast stores one event and pushes it to the org's open
// dashboards with the employee's name attached.
func recordAndBroadcast(ctx context.Context, db *gorm.DB, hub *WebSocketHub, ev *models.ActivityEvent) error {
	if err := dataplane.RecordEvents(ctx, ev.OrgID, ev); err != nil {
		return err
	}
	broadcastEvents(db, hub, []models.ActivityEvent{*ev})
	return nil
}

func broadcastEvents(db *gorm.DB, hub *WebSocketHub, events []models.ActivityEvent) {
	if hub == nil || len(events) == 0 {
		return
	}
	attachEmployees(db, events)
	for _, ev := range events {
		hub.BroadcastActivityEvent(ev)
	}
}

func eventPtrs(events []models.ActivityEvent) []*models.ActivityEvent {
	out := make([]*models.ActivityEvent, len(events))
	for i := range events {
		out[i] = &events[i]
	}
	return out
}
