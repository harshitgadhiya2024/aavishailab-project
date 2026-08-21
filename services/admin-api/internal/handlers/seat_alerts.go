package handlers

import (
	"net/http"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// SeatAlertHandler answers "which orgs are close to their seat limit" —
// computed live off the org's own max_users and its actual user count,
// against the threshold set in the notifications platform setting (default
// 80%), rather than a separately-maintained alert table that could drift
// from reality.
type SeatAlertHandler struct {
	db *gorm.DB
}

func NewSeatAlertHandler(db *gorm.DB) *SeatAlertHandler {
	return &SeatAlertHandler{db: db}
}

type seatAlert struct {
	OrgID       string `json:"org_id"`
	OrgName     string `json:"org_name"`
	UserCount   int64  `json:"user_count"`
	MaxUsers    int    `json:"max_users"`
	PercentUsed int    `json:"percent_used"`
}

// List handles GET /superadmin/seat-alerts
func (h *SeatAlertHandler) List(c *gin.Context) {
	threshold := 80
	var setting models.PlatformSetting
	if err := h.db.Where("key = ?", "notifications").First(&setting).Error; err == nil {
		if v, ok := setting.Value["seat_limit_alert_threshold_pct"].(float64); ok && v > 0 {
			threshold = int(v)
		}
	}

	type row struct {
		ID        string
		Name      string
		MaxUsers  int
		UserCount int64
	}
	var rows []row
	h.db.Raw(`
		SELECT o.id, o.name, o.max_users, COUNT(u.id) as user_count
		FROM organizations o
		LEFT JOIN users u ON u.org_id = o.id AND u.deleted_at IS NULL
		WHERE o.deleted_at IS NULL AND o.max_users > 0
		GROUP BY o.id, o.name, o.max_users
	`).Scan(&rows)

	alerts := make([]seatAlert, 0)
	for _, r := range rows {
		pct := int(float64(r.UserCount) / float64(r.MaxUsers) * 100)
		if pct >= threshold {
			alerts = append(alerts, seatAlert{
				OrgID: r.ID, OrgName: r.Name, UserCount: r.UserCount,
				MaxUsers: r.MaxUsers, PercentUsed: pct,
			})
		}
	}
	c.JSON(http.StatusOK, gin.H{"alerts": alerts, "threshold_pct": threshold, "total": len(alerts)})
}
