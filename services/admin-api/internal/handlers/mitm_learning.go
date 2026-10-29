package handlers

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SSL inspection that learns.
//
// When an app on a device refuses inspection (it pins certificates, keeps
// its own CA list, needs a client certificate, or speaks only HTTP/2), the
// agent stops inspecting that host on that device for a day and reports it
// here. This decides whether the whole platform should be passed through
// for everyone, so no other employee hits the same failure:
//
//   - A platform where data can leave the company (mail, file sharing,
//     cloud storage, chat and collaboration, AI tools, code and paste
//     hosting, social media) is never passed through automatically: losing
//     inspection there is a DLP blind spot, so admins are told instead.
//   - Anything else is passed through once it is known to be safe: right
//     away for a platform in a non-DLP category, and after two different
//     devices report it for an uncategorised one. A single device can never
//     switch inspection off for an unknown domain, which is what an
//     exfiltration server would be.

const (
	learnedBypassTTL       = 30 * 24 * time.Hour
	learnedMinDevices      = 2
	maxLearnedPerOrgServed = 500
)

var hostnameRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$`)

// dlpRelevantDomains are platforms an employee can move company data to,
// whatever their category says (most are uncategorised). Matched on the
// registrable domain.
var dlpRelevantDomains = map[string]bool{
	"slack.com": true, "slack-edge.com": true, "microsoft.com": true, "office.com": true, "office365.com": true,
	"office.net": true, "live.com": true, "outlook.com": true, "sharepoint.com": true, "onedrive.com": true,
	"teams.microsoft.com": true, "cloud.microsoft": true, "skype.com": true,
	"google.com": true, "googleapis.com": true, "googleusercontent.com": true, "gmail.com": true,
	"dropbox.com": true, "dropboxapi.com": true, "box.com": true, "boxcloud.com": true, "wetransfer.com": true,
	"icloud.com": true, "mega.nz": true, "mediafire.com": true, "pcloud.com": true,
	"github.com": true, "githubusercontent.com": true, "gitlab.com": true, "bitbucket.org": true,
	"pastebin.com": true, "hastebin.com": true, "ghostbin.com": true,
	"notion.so": true, "notion.com": true, "atlassian.net": true, "trello.com": true, "asana.com": true,
	"discord.com": true, "discordapp.com": true, "telegram.org": true, "t.me": true, "whatsapp.com": true,
	"openai.com": true, "chatgpt.com": true, "anthropic.com": true, "claude.ai": true, "gemini.google.com": true,
	"perplexity.ai": true, "deepseek.com": true, "mistral.ai": true, "huggingface.co": true,
	"yahoo.com": true, "proton.me": true, "protonmail.com": true, "zoho.com": true,
	"facebook.com": true, "instagram.com": true, "linkedin.com": true, "x.com": true, "twitter.com": true, "reddit.com": true,
}

// Categories where data can leave the company.
var dlpRelevantCategories = []string{"ai_tools", "webmail_personal_email", "cloud_storage", "social_media"}

// Managed-application categories where data can leave the company.
var dlpRelevantAppCategories = map[string]bool{"ai_tools": true, "file_sharing": true, "messaging": true, "remote_access": true}

// registrableDomain is the platform a host belongs to: the last two labels,
// or three under a two-letter country code's second level (co.uk, com.au).
func registrableDomain(host string) string {
	parts := strings.Split(strings.Trim(strings.ToLower(host), "."), ".")
	if len(parts) <= 2 {
		return strings.Join(parts, ".")
	}
	tld, second := parts[len(parts)-1], parts[len(parts)-2]
	if len(tld) == 2 {
		switch second {
		case "co", "com", "net", "org", "gov", "ac", "edu", "ne", "or":
			return strings.Join(parts[len(parts)-3:], ".")
		}
	}
	return strings.Join(parts[len(parts)-2:], ".")
}

// domainSuffixes: "a.b.example.com" → a.b.example.com, b.example.com, example.com.
func domainSuffixes(host string) []string {
	parts := strings.Split(host, ".")
	out := make([]string, 0, len(parts))
	for i := 0; i < len(parts)-1; i++ {
		out = append(out, strings.Join(parts[i:], "."))
	}
	return out
}

// mitmLearning classifies a reported host: whether data can leave through
// it, and whether it has a non-DLP category at all.
func (h *AgentHandler) mitmLearning(host, domain string) (dlpRelevant, categorised bool) {
	for _, s := range append(domainSuffixes(host), domain) {
		if dlpRelevantDomains[s] {
			return true, true
		}
	}
	var slugs []string
	h.db.Model(&models.CategoryDomain{}).
		Joins("JOIN url_categories ON url_categories.id = category_domains.category_id").
		Where("category_domains.domain IN ?", append(domainSuffixes(host), domain)).
		Pluck("url_categories.slug", &slugs)
	for _, s := range slugs {
		for _, d := range dlpRelevantCategories {
			if s == d {
				return true, true
			}
		}
	}
	var apps []models.ManagedApplication
	h.db.Select("category", "domains").Find(&apps)
	for _, a := range apps {
		for _, d := range a.Domains {
			d = strings.ToLower(strings.TrimPrefix(d, "*."))
			if d == domain || d == host || strings.HasSuffix(host, "."+d) {
				if dlpRelevantAppCategories[a.Category] {
					return true, true
				}
				categorised = true
			}
		}
	}
	return false, categorised || len(slugs) > 0
}

// ReportMITMRefusal handles POST /internal/agent/mitm-refusal
// {"host": "my.parallels.com", "reason": "refused_certificate"}.
func (h *AgentHandler) ReportMITMRefusal(c *gin.Context) {
	deviceID, orgID, empID := h.authAgent(c)
	if deviceID == uuid.Nil {
		return
	}
	var req struct {
		Host   string `json:"host"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	host := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(req.Host)), "www.")
	if len(host) > 253 || !hostnameRe.MatchString(host) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "host must be a hostname"})
		return
	}
	reason := req.Reason
	if len(reason) > 40 {
		reason = reason[:40]
	}
	domain := registrableDomain(host)
	dlpRelevant, categorised := h.mitmLearning(host, domain)
	wasLearned := h.learnedBypass(orgID, domain)

	now := time.Now()
	row := models.MITMRefusal{
		OrgID: orgID, DeviceID: deviceID, Host: host, Domain: domain, Reason: reason,
		DLPRelevant: dlpRelevant, Categorised: categorised, Count: 1, FirstSeen: now, LastSeen: now,
	}
	h.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "org_id"}, {Name: "device_id"}, {Name: "host"}},
		DoUpdates: clause.Assignments(map[string]any{"count": gorm.Expr("mitm_refusals.count + 1"), "last_seen": now, "reason": reason, "dlp_relevant": dlpRelevant, "categorised": categorised}),
	}).Create(&row)

	learned := h.learnedBypass(orgID, domain)
	var event *models.ActivityEvent
	switch {
	case dlpRelevant:
		event = &models.ActivityEvent{
			Action: models.EventActionAlerted, PolicyName: "DLP blind spot: an app refused SSL inspection",
			Metadata: map[string]any{"host": host, "reason": reason, "note": "Passed through on this device so the app keeps working. Uploads through it are not scanned."},
		}
	case learned && !wasLearned:
		event = &models.ActivityEvent{
			Action: models.EventActionLogged, PolicyName: "SSL inspection bypassed automatically",
			Metadata: map[string]any{"domain": domain, "host": host, "reason": reason, "note": "The platform's apps refuse inspection and it is not a place data can leave the company, so it is passed through for every device."},
		}
	}
	if event != nil {
		event.OrgID, event.EmployeeID, event.DeviceID = orgID, empID, &deviceID
		event.EventType, event.Target, event.TargetDomain = models.EventTypeWebRequest, host, domain
		event.Category, event.Timestamp = "ssl_inspection", now
		_ = recordAndBroadcast(c.Request.Context(), h.db, h.hub, event)
	}
	c.JSON(http.StatusOK, gin.H{"domain": domain, "bypass_for_everyone": learned, "dlp_relevant": dlpRelevant})
}

// learnedBypass: whether `domain` is passed through for every device of
// this org. Never for a DLP-relevant platform.
func (h *AgentHandler) learnedBypass(orgID uuid.UUID, domain string) bool {
	for _, d := range h.learnedBypassDomains(orgID) {
		if d == domain {
			return true
		}
	}
	return false
}

// learnedBypassDomains: platforms safe to pass through for this org. A
// categorised non-DLP platform needs one report from this org; an
// uncategorised one needs two devices in this org, or two organisations.
func (h *AgentHandler) learnedBypassDomains(orgID uuid.UUID) []string {
	var domains []string
	h.db.Raw(`
		SELECT domain FROM mitm_refusals
		WHERE NOT dlp_relevant AND last_seen > ?
		GROUP BY domain
		HAVING (bool_or(categorised) AND bool_or(org_id = ?))
		    OR COUNT(DISTINCT device_id) FILTER (WHERE org_id = ?) >= ?
		    OR (COUNT(DISTINCT org_id) >= 2 AND bool_or(org_id = ?))
		ORDER BY MAX(last_seen) DESC
		LIMIT ?`,
		time.Now().Add(-learnedBypassTTL), orgID, orgID, learnedMinDevices, orgID, maxLearnedPerOrgServed).Scan(&domains)
	return domains
}
