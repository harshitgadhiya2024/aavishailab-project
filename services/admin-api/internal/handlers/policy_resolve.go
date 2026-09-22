package handlers

import (
	"strings"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// categoryDomainsBySlug batch-loads every member domain for the given
// category slugs in one query, keyed by slug — avoids an N+1 query per
// policy when expanding Rules["categories"] into concrete domains.
//
// The list an org sees is the shipped seed rows (org_id IS NULL) plus the
// domains that org added itself, minus the seed domains it removed (which
// are masked by a CategoryDomainExclusion rather than deleted, so one
// tenant's edits never change another tenant's blocking).
func categoryDomainsBySlug(db *gorm.DB, orgID uuid.UUID, slugs []string) map[string][]string {
	result := make(map[string][]string)
	if len(slugs) == 0 {
		return result
	}
	type row struct {
		Slug   string
		Domain string
	}
	var rows []row
	db.Table("category_domains").
		Select("url_categories.slug as slug, category_domains.domain as domain").
		Joins("JOIN url_categories ON url_categories.id = category_domains.category_id").
		Where("url_categories.slug IN ? AND category_domains.deleted_at IS NULL", slugs).
		Where("category_domains.org_id IS NULL OR category_domains.org_id = ?", orgID).
		Where(`NOT EXISTS (
			SELECT 1 FROM category_domain_exclusions e
			WHERE e.org_id = ?
			  AND e.category_id = category_domains.category_id
			  AND e.domain = category_domains.domain
			  AND e.deleted_at IS NULL)`, orgID).
		Scan(&rows)
	for _, r := range rows {
		result[r.Slug] = append(result[r.Slug], r.Domain)
	}
	return result
}

// normalizePolicyDomain turns what an admin typed into the Web Gateway policy
// builder into the form the agent's rule cache matches on.
//
// The agent matches an exact host and then walks parent domains
// (cdn.openai.com → openai.com), so a suffix wildcard is already the *default*
// behaviour of a bare domain. That means "*.openai.com" and "openai.com" want
// to become the same rule, and stripping the wildcard is the whole job — a
// literal "*.openai.com" key would match no host at all and the policy would
// silently do nothing, which is the worst possible outcome for a block rule.
//
// Anything else (a scheme, a path, a port, uppercase, a trailing dot) is
// trimmed down to the bare host for the same reason: an admin pasting
// "https://chatgpt.com/" means the site, and a rule stored under that exact
// string would never fire.
func normalizePolicyDomain(raw string) string {
	d := strings.ToLower(strings.TrimSpace(raw))
	if d == "" {
		return ""
	}
	if i := strings.Index(d, "://"); i >= 0 {
		d = d[i+3:]
	}
	d = strings.TrimPrefix(d, "*.")
	// Credentials, path, query and fragment all end the host.
	if i := strings.IndexAny(d, "/?#"); i >= 0 {
		d = d[:i]
	}
	if i := strings.LastIndex(d, "@"); i >= 0 {
		d = d[i+1:]
	}
	// Port, but not an IPv6 literal's colons.
	if !strings.Contains(d, "]") {
		if i := strings.LastIndex(d, ":"); i >= 0 {
			d = d[:i]
		}
	}
	d = strings.TrimSuffix(strings.TrimSpace(d), ".")
	// "www." is stripped by the agent before matching, so a rule stored with
	// it would only ever be reachable via the parent-domain walk.
	d = strings.TrimPrefix(d, "www.")
	return d
}

// policyTargetMatches reports whether a policy (by its Targets jsonb) applies
// to an employee in the given team. Missing Targets or an explicit "all"
// scope always matches (the default every policy gets on creation) — this
// is what makes the New Policy wizard's target-selection step actually
// change enforcement instead of being cosmetic bookkeeping.
func policyTargetMatches(targets map[string]any, employeeID *uuid.UUID, teamID *uuid.UUID) bool {
	scope, _ := targets["scope"].(string)
	switch scope {
	case "", "all":
		return true
	case "team":
		if teamID == nil {
			return false
		}
		return idListContains(targets["team_ids"], teamID.String())
	case "employee":
		if employeeID == nil {
			return false
		}
		return idListContains(targets["employee_ids"], employeeID.String())
	default:
		return true
	}
}

func idListContains(raw any, target string) bool {
	ids, _ := raw.([]any)
	for _, id := range ids {
		if s, ok := id.(string); ok && s == target {
			return true
		}
	}
	return false
}

func filterPoliciesByTarget(policies []models.Policy, employeeID *uuid.UUID, teamID *uuid.UUID) []models.Policy {
	applicable := make([]models.Policy, 0, len(policies))
	for _, policy := range policies {
		if policyTargetMatches(policy.Targets, employeeID, teamID) {
			applicable = append(applicable, policy)
		}
	}
	return applicable
}

// resolvePolicyDomains expands a single policy's Rules["domains"] and
// Rules["categories"] into the concrete, deduplicated list of domains it
// covers — deliberately ignoring Targets (who the policy applies to), since
// this backs the admin-facing "what does this policy actually block" view,
// which should show the full list regardless of which teams/employees it's
// scoped to.
func resolvePolicyDomains(db *gorm.DB, p models.Policy, domainsBySlug map[string][]string) []string {
	seen := make(map[string]bool)
	var out []string
	add := func(domain string) {
		domain = normalizePolicyDomain(domain)
		if domain == "" || seen[domain] {
			return
		}
		seen[domain] = true
		out = append(out, domain)
	}

	if domains, ok := p.Rules["domains"].([]any); ok {
		for _, d := range domains {
			if s, ok := d.(string); ok {
				add(s)
			}
		}
	}
	if cats, ok := p.Rules["categories"].([]any); ok {
		for _, c := range cats {
			if slug, ok := c.(string); ok {
				for _, domain := range domainsBySlug[slug] {
					add(domain)
				}
			}
		}
	}
	return out
}

// ResolvePolicyDomains is resolvePolicyDomains for exactly one policy,
// fetching its own category domains — used by the policy detail/expand
// endpoint where only one policy is in play (batching wouldn't help).
func ResolvePolicyDomains(db *gorm.DB, p models.Policy) []string {
	var slugs []string
	if cats, ok := p.Rules["categories"].([]any); ok {
		for _, c := range cats {
			if s, ok := c.(string); ok && s != "" {
				slugs = append(slugs, s)
			}
		}
	}
	return resolvePolicyDomains(db, p, categoryDomainsBySlug(db, p.OrgID, slugs))
}

// expandPoliciesToDomainRules turns enabled policies into DomainRule-shaped
// entries the agent's flat rule cache understands — from explicit
// Rules["domains"] (pre-existing behavior) and now also Rules["categories"]
// (resolved via categoryDomainsBySlug) — filtered down to only the policies
// that actually target this employee/team.
func expandPoliciesToDomainRules(db *gorm.DB, orgID uuid.UUID, policies []models.Policy, employeeID *uuid.UUID, teamID *uuid.UUID) []models.DomainRule {
	var allSlugs []string
	for _, p := range policies {
		if cats, ok := p.Rules["categories"].([]any); ok {
			for _, c := range cats {
				if s, ok := c.(string); ok && s != "" {
					allSlugs = append(allSlugs, s)
				}
			}
		}
	}
	domainsBySlug := categoryDomainsBySlug(db, orgID, allSlugs)

	var out []models.DomainRule
	for _, p := range policies {
		if !policyTargetMatches(p.Targets, employeeID, teamID) {
			continue
		}
		orgCopy := p.OrgID

		for _, domain := range resolvePolicyDomains(db, p, domainsBySlug) {
			out = append(out, models.DomainRule{
				Base:     models.Base{ID: p.ID},
				OrgID:    &orgCopy,
				Domain:   domain,
				Action:   p.Action,
				Category: string(p.Type),
				Reason:   "Policy: " + p.Name,
				Enabled:  true,
			})
		}
	}
	return out
}

// filterApprovedExceptions removes any blocked-domain entry this employee
// has an approved access request for. An approved AccessRequest IS the
// exception — scoped to (employee, policy, domain), so approving one
// request never opens access wider than what was actually asked for (a
// different policy blocking the same domain string is unaffected).
func filterApprovedExceptions(db *gorm.DB, rules []models.DomainRule, employeeID uuid.UUID) []models.DomainRule {
	var approved []models.AccessRequest
	db.Where("employee_id = ? AND status = ?", employeeID, models.AccessRequestApproved).Find(&approved)
	if len(approved) == 0 {
		return rules
	}

	type key struct {
		PolicyID uuid.UUID
		Domain   string
	}
	exceptions := make(map[key]bool, len(approved))
	for _, a := range approved {
		exceptions[key{PolicyID: a.PolicyID, Domain: strings.ToLower(a.Domain)}] = true
	}

	filtered := rules[:0]
	for _, r := range rules {
		if r.Action == models.PolicyActionBlock && exceptions[key{PolicyID: r.ID, Domain: strings.ToLower(r.Domain)}] {
			continue
		}
		filtered = append(filtered, r)
	}
	return filtered
}
