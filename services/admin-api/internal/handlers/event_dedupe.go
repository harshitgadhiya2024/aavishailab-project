package handlers

import (
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
)

// One action on a laptop often reaches us as several reports: Gmail autosaves
// a draft every few seconds (each save is a full DLP scan), a VPN extension is
// installed once per Chrome profile, an app's helper processes are each
// stopped, and a browser retries a blocked page. Stored one row each, the
// Activity tab showed the same thing 2–6 times in a row.
//
// dataplane.RecordDeduped folds such a report into the matching recent row
// instead: same device, same event type and action, same dedupe key, and the
// previous copy (or the last one folded into it) within `window`. The row
// keeps its first timestamp and gains metadata.repeat_count /
// metadata.last_seen_at, so nothing is lost — "6 times in 40 seconds" is
// still visible. The window slides: a draft being written for five minutes
// stays one incident.
//
// This file holds what decides "the same report": the dedupe keys, and the
// merges that carry details of the new report onto the kept row (e.g. a
// higher DLP score, another browser profile).

const (
	webBlockDedupeWindow  = 60 * time.Second
	appBlockDedupeWindow  = 60 * time.Second
	extensionDedupeWindow = 10 * time.Minute
	dlpTextDedupeWindow   = 2 * time.Minute
)

// webDedupeKey: the blocked host, so http://x, https://x and https://www.x/
// retried seconds apart are one block.
func webDedupeKey(ev *models.ActivityEvent) string {
	host := ev.TargetDomain
	if host == "" {
		if u, err := url.Parse(ev.Target); err == nil && u.Host != "" {
			host = u.Hostname()
		} else {
			host = ev.Target
		}
	}
	host = normDomain(host)
	if host == "" {
		return ""
	}
	return "web|" + host
}

// dlpTextDedupeKey: the same kinds of finding going to the same place on the
// same channel. Autosaved drafts differ slightly every time (the text grows,
// and the AI words its explanation differently), so the content itself can't
// be the key.
func dlpTextDedupeKey(site, path string, detectors []string) string {
	d := append([]string(nil), detectors...)
	sort.Strings(d)
	return "dlp-text|" + strings.ToLower(site) + "|" + strings.SplitN(path, "?", 2)[0] + "|" + strings.Join(d, ",")
}

// keepWorstDLP keeps the most severe version of a repeated DLP finding: a
// draft that gains a card number half-way through must end up scored as one.
func keepWorstDLP(kept, next *models.ActivityEvent) {
	if next.RiskScore <= kept.RiskScore {
		return
	}
	kept.RiskScore = next.RiskScore
	kept.PolicyID = next.PolicyID
	kept.PolicyName = next.PolicyName
	for _, k := range []string{"score", "band", "matches"} {
		if v, ok := next.Metadata[k]; ok {
			kept.Metadata[k] = v
		}
	}
	if kept.Target == "" {
		kept.Target = next.Target
	}
}

// mergeExtensionProfiles records every browser profile the extension was found
// in on the one row.
func mergeExtensionProfiles(kept, next *models.ActivityEvent) {
	seen := map[string]bool{}
	var profiles []string
	add := func(p any) {
		s, _ := p.(string)
		if s != "" && !seen[s] {
			seen[s] = true
			profiles = append(profiles, s)
		}
	}
	if list, ok := kept.Metadata["profiles"].([]any); ok {
		for _, p := range list {
			add(p)
		}
	}
	add(kept.Metadata["profile"])
	add(next.Metadata["profile"])
	kept.Metadata["profiles"] = profiles
}
