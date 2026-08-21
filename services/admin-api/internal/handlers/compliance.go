package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ComplianceHandler covers the two ends of an org's data lifecycle a
// superadmin previously had no tooling for at all: exporting everything
// (a GDPR-style access request, or just an offboarding record) and
// permanently purging it (the actual deletion behind Organizations.Delete's
// soft-delete, for when "deactivated" needs to become "gone").
type ComplianceHandler struct {
	db *gorm.DB
}

func NewComplianceHandler(db *gorm.DB) *ComplianceHandler {
	return &ComplianceHandler{db: db}
}

type orgExportBundle struct {
	ExportedAt     time.Time              `json:"exported_at"`
	Organization   models.Organization    `json:"organization"`
	Users          []*UserDTO             `json:"users"`
	Employees      []models.Employee      `json:"employees"`
	Devices        []models.Device        `json:"devices"`
	Policies       []models.Policy        `json:"policies"`
	DomainRules    []models.DomainRule    `json:"domain_rules"`
	CASBRules      []models.CASBRule      `json:"casb_rules"`
	RecentActivity []models.ActivityEvent `json:"recent_activity"`
	BillingRecords []models.BillingRecord `json:"billing_records"`
}

// Export handles GET /superadmin/organizations/:id/export — streams a JSON
// bundle as a file download. Recent activity is capped (10,000 rows) so
// this stays a normal HTTP response rather than needing background job
// infrastructure; an org with more history than that is a future
// pagination problem, not a reason to hold this back today.
func (h *ComplianceHandler) Export(c *gin.Context) {
	orgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad organization id"})
		return
	}
	var org models.Organization
	if err := h.db.First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	var users []models.User
	h.db.Where("org_id = ?", orgID).Find(&users)
	userDTOs := make([]*UserDTO, 0, len(users))
	for i := range users {
		userDTOs = append(userDTOs, toUserDTO(&users[i]))
	}

	bundle := orgExportBundle{ExportedAt: time.Now(), Organization: org, Users: userDTOs}
	h.db.Where("org_id = ?", orgID).Find(&bundle.Employees)
	h.db.Where("org_id = ?", orgID).Find(&bundle.Devices)
	h.db.Where("org_id = ?", orgID).Find(&bundle.Policies)
	h.db.Where("org_id = ?", orgID).Find(&bundle.DomainRules)
	h.db.Where("org_id = ?", orgID).Find(&bundle.CASBRules)
	h.db.Where("org_id = ?", orgID).Order("timestamp DESC").Limit(10000).Find(&bundle.RecentActivity)
	h.db.Where("org_id = ?", orgID).Find(&bundle.BillingRecords)

	writeAudit(h.db, c, &orgID, "export", "organization", &orgID, map[string]any{"org_name": org.Name})

	filename := fmt.Sprintf("%s-export-%s.json", org.Slug, time.Now().UTC().Format("2006-01-02"))
	c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
	c.JSON(http.StatusOK, bundle)
}

type purgeRequest struct {
	// Confirm must exactly equal the org's slug — a typed confirmation, not
	// just a boolean, because this is the one action in the whole platform
	// that cannot be undone by restoring a soft-delete.
	Confirm string `json:"confirm" binding:"required"`
}

// Purge handles POST /superadmin/organizations/:id/purge — SuperAdminFullOnly
// at the router. Requires the org to already be inactive (Delete() already
// called) and the request body to name the org by its slug, so this can
// never be one accidental click away from Delete().
func (h *ComplianceHandler) Purge(c *gin.Context) {
	orgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad organization id"})
		return
	}
	var org models.Organization
	// Unscoped: Delete() already soft-deleted it, and that's exactly the
	// state this endpoint requires — a normal First() would 404 on it.
	if err := h.db.Unscoped().First(&org, "id = ?", orgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}
	if !org.DeletedAt.Valid {
		c.JSON(http.StatusConflict, gin.H{"error": "Deactivate this organization first (soft-delete) before permanently purging it"})
		return
	}

	var req purgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Confirm != org.Slug {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Confirmation text must exactly match the organization's slug: " + org.Slug})
		return
	}

	// Recorded before deletion — this is the org's last audit entry, and it
	// has to survive the org itself being gone, so it's written with a nil
	// OrgID (platform-level) carrying the name/slug in Changes instead of a
	// foreign key that's about to dangle.
	writeAudit(h.db, c, nil, "purge", "organization", &orgID, map[string]any{
		"org_name": org.Name, "org_slug": org.Slug,
	})

	h.db.Transaction(func(tx *gorm.DB) error {
		tx.Unscoped().Where("org_id = ?", orgID).Delete(&models.User{})
		tx.Unscoped().Where("org_id = ?", orgID).Delete(&models.Employee{})
		tx.Unscoped().Where("org_id = ?", orgID).Delete(&models.Device{})
		tx.Unscoped().Where("org_id = ?", orgID).Delete(&models.Policy{})
		tx.Unscoped().Where("org_id = ?", orgID).Delete(&models.DomainRule{})
		tx.Unscoped().Where("org_id = ?", orgID).Delete(&models.CASBRule{})
		tx.Unscoped().Where("org_id = ?", orgID).Delete(&models.ActivityEvent{})
		tx.Unscoped().Where("org_id = ?", orgID).Delete(&models.BillingRecord{})
		tx.Unscoped().Where("flag_id IN (SELECT id FROM feature_flags) AND org_id = ?", orgID).Delete(&models.FeatureFlagOrg{})
		tx.Where("ticket_id IN (SELECT id FROM support_tickets WHERE org_id = ?)", orgID).Delete(&models.SupportTicketMessage{})
		tx.Unscoped().Where("org_id = ?", orgID).Delete(&models.SupportTicket{})
		tx.Unscoped().Where("id = ?", orgID).Delete(&models.Organization{})
		return nil
	})

	c.JSON(http.StatusOK, gin.H{"message": "Organization permanently purged"})
}
