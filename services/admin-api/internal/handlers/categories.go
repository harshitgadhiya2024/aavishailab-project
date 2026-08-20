package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CategoryHandler serves the company-facing URL category library: the shipped
// category lists plus whatever domains a company added or removed on top of
// them. Company edits are always org-scoped — adding writes a category_domains
// row carrying the org id, removing a built-in domain writes an exclusion —
// so one tenant editing a list never changes what another tenant blocks.
type CategoryHandler struct {
	db *gorm.DB
}

func NewCategoryHandler(db *gorm.DB) *CategoryHandler {
	return &CategoryHandler{db: db}
}

// normalizeDomain strips the noise users paste in (scheme, path, www., case,
// stray whitespace) so "https://WWW.Facebook.com/login" and "facebook.com"
// don't both end up in a list as separate entries.
func normalizeDomain(raw string) string {
	d := strings.ToLower(strings.TrimSpace(raw))
	d = strings.TrimPrefix(d, "https://")
	d = strings.TrimPrefix(d, "http://")
	if i := strings.IndexAny(d, "/?#"); i >= 0 {
		d = d[:i]
	}
	d = strings.TrimPrefix(d, "www.")
	d = strings.Trim(d, ".")
	if !strings.Contains(d, ".") || strings.ContainsAny(d, " \t,") {
		return ""
	}
	return d
}

// List handles GET /categories — every category with the effective domain
// count for this org (seed rows + own additions − own removals).
func (h *CategoryHandler) List(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))
	search := strings.ToLower(strings.TrimSpace(c.Query("search")))

	var categories []models.URLCategory
	q := h.db.Order("name ASC")
	if search != "" {
		q = q.Where("LOWER(name) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(description) LIKE ?",
			"%"+search+"%", "%"+search+"%", "%"+search+"%")
	}
	q.Find(&categories)

	type countRow struct {
		CategoryID uuid.UUID
		Count      int
	}
	var counts []countRow
	h.effectiveDomainsQuery(orgID).
		Select("category_domains.category_id as category_id, COUNT(*) as count").
		Group("category_domains.category_id").
		Scan(&counts)

	countByCategory := make(map[uuid.UUID]int, len(counts))
	for _, r := range counts {
		countByCategory[r.CategoryID] = r.Count
	}

	type categoryResponse struct {
		models.URLCategory
		DomainCount int `json:"domain_count"`
	}
	out := make([]categoryResponse, 0, len(categories))
	for _, cat := range categories {
		out = append(out, categoryResponse{URLCategory: cat, DomainCount: countByCategory[cat.ID]})
	}

	c.JSON(http.StatusOK, gin.H{"data": out, "total": len(out)})
}

// effectiveDomainsQuery is the one definition of "which domains does this org
// see in a category": shared seed rows plus the org's own additions, minus the
// seed domains this org removed.
func (h *CategoryHandler) effectiveDomainsQuery(orgID uuid.UUID) *gorm.DB {
	return h.db.Table("category_domains").
		Where("category_domains.deleted_at IS NULL").
		Where("category_domains.org_id IS NULL OR category_domains.org_id = ?", orgID).
		Where(`NOT EXISTS (
			SELECT 1 FROM category_domain_exclusions e
			WHERE e.org_id = ?
			  AND e.category_id = category_domains.category_id
			  AND e.domain = category_domains.domain
			  AND e.deleted_at IS NULL)`, orgID)
}

// ListDomains handles GET /categories/:id/domains
func (h *CategoryHandler) ListDomains(c *gin.Context) {
	orgID, _ := uuid.Parse(c.GetString("scoped_org_id"))

	var category models.URLCategory
	if err := h.db.Where("id = ?", c.Param("id")).First(&category).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 500 {
		limit = 50
	}
	search := strings.ToLower(strings.TrimSpace(c.Query("search")))

	base := h.effectiveDomainsQuery(orgID).Where("category_domains.category_id = ?", category.ID)
	if search != "" {
		base = base.Where("LOWER(category_domains.domain) LIKE ?", "%"+search+"%")
	}

	var total int64
	base.Session(&gorm.Session{}).Count(&total)

	type domainRow struct {
		ID     uuid.UUID  `json:"id"`
		Domain string     `json:"domain"`
		Source string     `json:"source"`
		OrgID  *uuid.UUID `json:"org_id"`
	}
	var rows []domainRow
	base.Session(&gorm.Session{}).
		Select("category_domains.id, category_domains.domain, category_domains.source, category_domains.org_id").
		Order("category_domains.domain ASC").
		Offset((page - 1) * limit).Limit(limit).
		Scan(&rows)

	type domainResponse struct {
		ID     uuid.UUID `json:"id"`
		Domain string    `json:"domain"`
		Source string    `json:"source"`
		Scope  string    `json:"scope"` // "custom" = added by this org, "builtin" = shipped list
	}
	out := make([]domainResponse, 0, len(rows))
	for _, r := range rows {
		scope := "builtin"
		if r.OrgID != nil {
			scope = "custom"
		}
		out = append(out, domainResponse{ID: r.ID, Domain: r.Domain, Source: r.Source, Scope: scope})
	}

	c.JSON(http.StatusOK, gin.H{
		"data":     out,
		"total":    total,
		"page":     page,
		"limit":    limit,
		"category": category,
	})
}

// AddDomains handles POST /categories/:id/domains
// Accepts {"domain": "x.com"} or {"domains": ["x.com", "y.com"]}, so pasting a
// list works as well as adding one at a time.
func (h *CategoryHandler) AddDomains(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Organization scope required"})
		return
	}

	var category models.URLCategory
	if err := h.db.Where("id = ?", c.Param("id")).First(&category).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}

	var req struct {
		Domain  string   `json:"domain"`
		Domains []string `json:"domains"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	raw := req.Domains
	if req.Domain != "" {
		raw = append(raw, req.Domain)
	}

	seen := make(map[string]bool)
	var invalid []string
	var added, restored, already int

	for _, entry := range raw {
		// One field may carry a pasted list — split on the usual separators.
		for _, part := range strings.FieldsFunc(entry, func(r rune) bool {
			return r == ',' || r == '\n' || r == '\r' || r == ' ' || r == '\t' || r == ';'
		}) {
			domain := normalizeDomain(part)
			if domain == "" {
				if strings.TrimSpace(part) != "" {
					invalid = append(invalid, strings.TrimSpace(part))
				}
				continue
			}
			if seen[domain] {
				continue
			}
			seen[domain] = true

			// Re-adding a built-in domain the org had removed just lifts the
			// exclusion instead of creating a duplicate custom row.
			res := h.db.Where("org_id = ? AND category_id = ? AND domain = ?", orgID, category.ID, domain).
				Delete(&models.CategoryDomainExclusion{})
			if res.RowsAffected > 0 {
				restored++
				continue
			}

			var existing int64
			h.db.Model(&models.CategoryDomain{}).
				Where("category_id = ? AND domain = ? AND (org_id IS NULL OR org_id = ?)", category.ID, domain, orgID).
				Count(&existing)
			if existing > 0 {
				already++
				continue
			}

			if err := h.db.Create(&models.CategoryDomain{
				OrgID:      &orgID,
				CategoryID: category.ID,
				Domain:     domain,
				Source:     "manual",
			}).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add domain " + domain})
				return
			}
			added++
		}
	}

	// Only a request that parsed to nothing usable is an error. Domains that
	// were already in the category are reported back as "already", not as a
	// failure — pasting an overlapping list is normal, not a mistake.
	if len(seen) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid domains provided", "invalid": invalid})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"added":    added,
		"restored": restored,
		"already":  already,
		"invalid":  invalid,
		"message":  "Domains updated",
	})
}

// DeleteDomain handles DELETE /categories/:id/domains?domain=x.com
// A domain the org added is deleted outright; a built-in one is masked with an
// exclusion so it disappears for this org only.
func (h *CategoryHandler) DeleteDomain(c *gin.Context) {
	orgID, err := uuid.Parse(c.GetString("scoped_org_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Organization scope required"})
		return
	}

	categoryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid category id"})
		return
	}

	domain := normalizeDomain(c.Query("domain"))
	if domain == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A domain query parameter is required"})
		return
	}

	var owned models.CategoryDomain
	err = h.db.Where("category_id = ? AND domain = ? AND org_id = ?", categoryID, domain, orgID).
		First(&owned).Error
	if err == nil {
		if err := h.db.Delete(&owned).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove domain"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Domain removed"})
		return
	}
	if err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to look up domain"})
		return
	}

	var builtin int64
	h.db.Model(&models.CategoryDomain{}).
		Where("category_id = ? AND domain = ? AND org_id IS NULL", categoryID, domain).
		Count(&builtin)
	if builtin == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Domain not found in this category"})
		return
	}

	var existing int64
	h.db.Model(&models.CategoryDomainExclusion{}).
		Where("org_id = ? AND category_id = ? AND domain = ?", orgID, categoryID, domain).
		Count(&existing)
	if existing == 0 {
		if err := h.db.Create(&models.CategoryDomainExclusion{
			OrgID:      orgID,
			CategoryID: categoryID,
			Domain:     domain,
		}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove domain"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Domain removed for your organization"})
}
