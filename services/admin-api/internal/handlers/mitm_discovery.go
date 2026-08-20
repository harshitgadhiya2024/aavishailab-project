package handlers

import (
	_ "embed"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strings"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
)

//go:embed assets/mitm_platforms.json
var mitmPlatformsJSON []byte

// Bypass discovery answers "which of this platform's many hostnames do I
// actually need to exclude from SSL inspection?". A platform like AWS or Azure
// answers on dozens of hostnames, but only a few break under interception or
// carry data a company won't decrypt — so the workflow proposes candidates
// (from a curated catalog plus what this org's own agents have really seen)
// and lets the admin pick.

type catalogDomain struct {
	Domain      string   `json:"domain"`
	Note        string   `json:"note"`
	Tags        []string `json:"tags"`
	Recommended bool     `json:"recommended"`
}

type catalogGroup struct {
	Group       string          `json:"group"`
	Description string          `json:"description"`
	Domains     []catalogDomain `json:"domains"`
}

type catalogPlatform struct {
	Name    string         `json:"name"`
	Aliases []string       `json:"aliases"`
	Groups  []catalogGroup `json:"groups"`
}

type platformCatalog struct {
	Platforms []catalogPlatform `json:"platforms"`
}

var mitmCatalog platformCatalog

func init() {
	if err := json.Unmarshal(mitmPlatformsJSON, &mitmCatalog); err != nil {
		log.Printf("failed to parse mitm_platforms.json: %v", err)
	}
}

// discoveredDomain is one candidate the admin can select.
type discoveredDomain struct {
	Domain      string   `json:"domain"`
	Note        string   `json:"note"`
	Tags        []string `json:"tags"`
	Recommended bool     `json:"recommended"`
	// Source is "catalog" for curated platform knowledge, "observed" for a
	// hostname this org's own devices have actually connected to.
	Source string `json:"source"`
	// SeenCount is how many times this org's agents reported the domain, so an
	// admin can tell a hostname their people really use from one they don't.
	SeenCount int `json:"seen_count"`
	// AlreadyBypassed marks domains already excluded, so the UI can show them
	// as done rather than offering them again.
	AlreadyBypassed bool `json:"already_bypassed"`
}

type discoveredGroup struct {
	Group       string             `json:"group"`
	Description string             `json:"description"`
	Domains     []discoveredDomain `json:"domains"`
}

// DiscoverBypassDomains handles GET /settings/mitm/discover?query=aws
func (h *AgentHandler) DiscoverBypassDomains(c *gin.Context) {
	orgID := c.GetString("scoped_org_id")
	query := strings.ToLower(strings.TrimSpace(c.Query("query")))
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A platform name or domain is required"})
		return
	}

	var org models.Organization
	if err := h.db.Where("id = ?", orgID).First(&org).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}
	_, existing := mitmSettingsFromOrg(&org)
	alreadyBypassed := make(map[string]bool, len(existing))
	for _, d := range existing {
		alreadyBypassed[d] = true
	}
	for _, d := range defaultMITMBypassDomains() {
		alreadyBypassed[strings.ToLower(d)] = true
	}

	platform := matchPlatform(query)
	observedCounts := h.observedDomains(orgID, query, platform)

	var groups []discoveredGroup
	platformName := ""

	if platform != nil {
		platformName = platform.Name
		for _, g := range platform.Groups {
			out := discoveredGroup{Group: g.Group, Description: g.Description}
			for _, d := range g.Domains {
				domain := strings.ToLower(d.Domain)
				out.Domains = append(out.Domains, discoveredDomain{
					Domain:          domain,
					Note:            d.Note,
					Tags:            d.Tags,
					Recommended:     d.Recommended,
					Source:          "catalog",
					SeenCount:       observedCounts[domain],
					AlreadyBypassed: alreadyBypassed[domain],
				})
				// A curated hostname is no longer a separate "observed" finding.
				delete(observedCounts, domain)
			}
			if len(out.Domains) > 0 {
				groups = append(groups, out)
			}
		}
	}

	// Whatever this org's own agents saw that the catalog doesn't know about —
	// internal hostnames and per-tenant subdomains live here.
	if len(observedCounts) > 0 {
		observed := discoveredGroup{
			Group:       "Seen in your organization's traffic",
			Description: "Hostnames your devices actually connected to that match this search — including internal and tenant-specific subdomains.",
		}
		domains := make([]string, 0, len(observedCounts))
		for d := range observedCounts {
			domains = append(domains, d)
		}
		// Most-used first: the ones worth deciding about are at the top.
		sort.Slice(domains, func(i, j int) bool {
			if observedCounts[domains[i]] != observedCounts[domains[j]] {
				return observedCounts[domains[i]] > observedCounts[domains[j]]
			}
			return domains[i] < domains[j]
		})
		if len(domains) > 100 {
			domains = domains[:100]
		}
		for _, d := range domains {
			observed.Domains = append(observed.Domains, discoveredDomain{
				Domain:          d,
				Note:            "Observed on your endpoints",
				Tags:            []string{"observed"},
				Source:          "observed",
				SeenCount:       observedCounts[d],
				AlreadyBypassed: alreadyBypassed[d],
			})
		}
		groups = append(groups, observed)
	}

	// Nothing curated and nothing observed: still let the admin proceed with
	// exactly what they typed, if it looks like a hostname.
	if len(groups) == 0 && strings.Contains(query, ".") {
		groups = append(groups, discoveredGroup{
			Group:       "Exact match",
			Description: "No catalog entry or observed traffic for this one — add it as typed.",
			Domains: []discoveredDomain{{
				Domain:          query,
				Note:            "Entered manually",
				Source:          "manual",
				Recommended:     true,
				AlreadyBypassed: alreadyBypassed[query],
			}},
		})
	}

	total := 0
	for _, g := range groups {
		total += len(g.Domains)
	}

	c.JSON(http.StatusOK, gin.H{
		"query":    query,
		"platform": platformName,
		"groups":   groups,
		"total":    total,
	})
}

// matchPlatform finds the catalog entry for a free-text query — a product name
// ("azure"), an alias ("m365") or any hostname belonging to it.
func matchPlatform(query string) *catalogPlatform {
	for i := range mitmCatalog.Platforms {
		p := &mitmCatalog.Platforms[i]
		if strings.Contains(strings.ToLower(p.Name), query) {
			return p
		}
		for _, alias := range p.Aliases {
			if alias == query || strings.Contains(query, alias) || strings.Contains(alias, query) {
				return p
			}
		}
	}
	// Fall back to matching a hostname the catalog lists.
	for i := range mitmCatalog.Platforms {
		p := &mitmCatalog.Platforms[i]
		for _, g := range p.Groups {
			for _, d := range g.Domains {
				if strings.Contains(strings.ToLower(d.Domain), query) || strings.Contains(query, strings.ToLower(d.Domain)) {
					return p
				}
			}
		}
	}
	return nil
}

// observedDomains counts the hostnames this org's agents reported that relate
// to the query — matched on the query itself and on the catalog platform's
// domains, so searching "azure" also surfaces the tenant's own
// contoso.vault.azure.net.
func (h *AgentHandler) observedDomains(orgID, query string, platform *catalogPlatform) map[string]int {
	patterns := []string{"%" + query + "%"}
	if platform != nil {
		for _, g := range platform.Groups {
			for _, d := range g.Domains {
				patterns = append(patterns, "%"+strings.ToLower(d.Domain)+"%")
			}
		}
	}

	type row struct {
		Domain string
		Count  int
	}
	var rows []row
	q := h.db.Model(&models.ActivityEvent{}).
		Select("LOWER(target_domain) as domain, COUNT(*) as count").
		Where("org_id = ? AND target_domain <> ''", orgID)

	conds := h.db.Where("LOWER(target_domain) LIKE ?", patterns[0])
	for _, p := range patterns[1:] {
		conds = conds.Or("LOWER(target_domain) LIKE ?", p)
	}
	q.Where(conds).
		Group("LOWER(target_domain)").
		Order("count DESC").
		Limit(200).
		Scan(&rows)

	out := make(map[string]int, len(rows))
	for _, r := range rows {
		out[r.Domain] = r.Count
	}
	return out
}

// ListBypassPlatforms handles GET /settings/mitm/platforms — the suggestion
// chips shown before the admin has typed anything.
func (h *AgentHandler) ListBypassPlatforms(c *gin.Context) {
	names := make([]string, 0, len(mitmCatalog.Platforms))
	for _, p := range mitmCatalog.Platforms {
		names = append(names, p.Name)
	}
	c.JSON(http.StatusOK, gin.H{"platforms": names})
}
