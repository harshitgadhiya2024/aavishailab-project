package handlers

import (
	"net/url"
	"strings"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// accessTarget is what an employee can ask for from one activity row: the
// kind of exception, the thing it names, and how to show it.
type accessTarget struct {
	Kind     models.AccessRequestKind
	Resource string
	Label    string
}

// requestableFrom decides what, if anything, an activity row lets its
// employee ask for. Only rows where the company can actually grant something
// qualify; the rest (device posture, connect/disconnect, installs) are
// information, and the portal says what to do instead.
func requestableFrom(ev *models.ActivityEvent) (accessTarget, bool) {
	meta := ev.Metadata
	str := func(k string) string {
		s, _ := meta[k].(string)
		return strings.TrimSpace(s)
	}
	cat := strings.ToLower(ev.Category)

	switch {
	case cat == "malware" || cat == "malware_detection":
		if ev.Action != models.EventActionBlocked || str("sha256") == "" {
			return accessTarget{}, false
		}
		label := ev.Target
		if label == "" {
			label = "Blocked download"
		}
		return accessTarget{models.AccessKindDownload, strings.ToLower(str("sha256")), label}, true

	case cat == "dlp":
		desc := str("service")
		if desc == "" {
			desc = str("destination")
		}
		if desc == "" {
			desc = str("app_name")
		}
		if desc == "" {
			desc = ev.TargetDomain
		}
		label := "Sensitive data sent"
		if desc != "" {
			label += " to " + desc
		}
		if ev.Target != "" {
			label += " (" + ev.Target + ")"
		}
		return accessTarget{models.AccessKindDLP, ev.ID.String(), label}, true

	case str("kind") == "browser_extension":
		if ev.Operation != OpBrowserExtInstalled || str("extension_id") == "" {
			return accessTarget{}, false
		}
		return accessTarget{models.AccessKindExtension, str("extension_id"), ev.Target}, true

	case ev.EventType == models.EventTypeProcessStart || ev.EventType == models.EventTypeAppLaunch:
		if ev.Action != models.EventActionBlocked && ev.Action != models.EventActionAlerted {
			return accessTarget{}, false
		}
		appID := str("app_id")
		if _, err := uuid.Parse(appID); err != nil {
			return accessTarget{}, false
		}
		return accessTarget{models.AccessKindApplication, appID, ev.Target}, true

	case ev.EventType == models.EventTypeWebRequest || ev.EventType == models.EventTypeDNSQuery:
		if ev.Action != models.EventActionBlocked {
			return accessTarget{}, false
		}
		host := eventHost(ev)
		if host == "" {
			return accessTarget{}, false
		}
		return accessTarget{models.AccessKindWebsite, host, host}, true
	}
	return accessTarget{}, false
}

// eventHost is the normalised host a web row is about.
func eventHost(ev *models.ActivityEvent) string {
	host := ev.TargetDomain
	if host == "" {
		if u, err := url.Parse(ev.Target); err == nil && u.Host != "" {
			host = u.Hostname()
		} else {
			host = ev.Target
		}
	}
	return normDomain(host)
}

// accessGrants is everything one employee currently has approved.
type accessGrants struct {
	websites   map[string]bool
	apps       map[uuid.UUID]bool
	extensions map[string]bool
	downloads  map[string]bool
}

func (g accessGrants) empty() bool {
	return len(g.websites)+len(g.apps)+len(g.extensions)+len(g.downloads) == 0
}

func approvedGrants(db *gorm.DB, employeeID *uuid.UUID) accessGrants {
	g := accessGrants{
		websites: map[string]bool{}, apps: map[uuid.UUID]bool{},
		extensions: map[string]bool{}, downloads: map[string]bool{},
	}
	if employeeID == nil {
		return g
	}
	var approved []models.AccessRequest
	db.Select("kind", "resource", "domain").
		Where("employee_id = ? AND status = ?", *employeeID, models.AccessRequestApproved).
		Find(&approved)
	for _, a := range approved {
		switch a.Kind {
		case models.AccessKindApplication:
			if id, err := uuid.Parse(a.Resource); err == nil {
				g.apps[id] = true
			}
		case models.AccessKindExtension:
			g.extensions[a.Resource] = true
		case models.AccessKindDownload:
			g.downloads[strings.ToLower(a.Resource)] = true
		case models.AccessKindDLP:
			// Nothing to enforce: DLP never blocks.
		default: // website, and requests from before kinds existed
			host := a.Resource
			if host == "" {
				host = a.Domain
			}
			if host = normDomain(host); host != "" {
				g.websites[host] = true
			}
		}
	}
	return g
}

// websiteBundle widens an approved host to the product it belongs to: a site
// is rarely one host (LinkedIn needs licdn.com for its pages to render), so
// when the catalog knows the application a host belongs to, all of that
// application's hosts are allowed together.
func websiteBundle(db *gorm.DB, orgID uuid.UUID, host string) []string {
	out := []string{host}
	var apps []models.ManagedApplication
	db.Where("(org_id IS NULL OR org_id = ?) AND domains @> ?::jsonb", orgID, `["`+strings.ReplaceAll(host, `"`, ``)+`"]`).
		Find(&apps)
	seen := map[string]bool{host: true}
	for _, a := range apps {
		for _, d := range a.Domains {
			d = normDomain(d)
			if d != "" && !seen[d] {
				seen[d] = true
				out = append(out, d)
			}
		}
	}
	return out
}

// filterApprovedExceptions applies an employee's approved website requests to
// the rule list sent to their device: any block or alert rule on an approved
// host is dropped and an allow rule for that host is added. The agent checks
// a host's own rule before walking up to its parent domains, so allowing
// payroll.razorpay.com does not open the rest of razorpay.com. Threat
// intelligence is a separate check on the agent and still blocks a host that
// turns malicious.
func filterApprovedExceptions(db *gorm.DB, rules []models.DomainRule, orgID uuid.UUID, employeeID uuid.UUID) []models.DomainRule {
	g := approvedGrants(db, &employeeID)
	if len(g.websites) == 0 {
		return rules
	}
	allowed := map[string]bool{}
	for host := range g.websites {
		for _, d := range websiteBundle(db, orgID, host) {
			allowed[d] = true
		}
	}

	// A platform-wide block (no org: the risk engine's verdicts) is a
	// security finding, not company policy, so no company approval lifts it.
	platformBlocked := map[string]bool{}
	filtered := rules[:0]
	for _, r := range rules {
		host := normDomain(r.Domain)
		if r.OrgID == nil && r.Action == models.PolicyActionBlock {
			platformBlocked[host] = true
			filtered = append(filtered, r)
			continue
		}
		if allowed[host] && r.Action != models.PolicyActionAllow {
			continue
		}
		filtered = append(filtered, r)
	}
	org := orgID
	for host := range allowed {
		if platformBlocked[host] {
			continue
		}
		filtered = append(filtered, models.DomainRule{
			OrgID:    &org,
			Domain:   host,
			Action:   models.PolicyActionAllow,
			Category: "access_request",
			Reason:   "Access approved by your company",
			Enabled:  true,
		})
	}
	return filtered
}
