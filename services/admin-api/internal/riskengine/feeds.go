package riskengine

import (
	"bufio"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Threat-intel feeds — all free, public, no signup or API key required:
//   - URLhaus (abuse.ch): malware distribution domains, hosts-file format
//   - OpenPhish: community phishing feed, plain list of phishing URLs
//
// Feodo Tracker (abuse.ch botnet C2 list) is intentionally NOT integrated:
// it publishes IP addresses, not domains, and this system's enforcement is
// domain-based — bolting on IP blocking would need a materially different
// enforcement path (the agent would need to check resolved IPs, not just
// hostnames). Rather than fake partial "botnet" coverage, that's left out.

const (
	urlhausHostfileURL = "https://urlhaus.abuse.ch/downloads/hostfile/"
	openPhishFeedURL   = "https://openphish.com/feed.txt"
	feedFetchTimeout   = 30 * time.Second
)

var feedHTTPClient = &http.Client{Timeout: feedFetchTimeout}

// SyncThreatFeeds fetches both feeds and upserts every domain found into
// threat_intel_domains. Safe to call repeatedly on a schedule — existing
// rows just get their last_seen_at bumped.
func SyncThreatFeeds(db *gorm.DB) {
	if domains, err := fetchURLhaus(); err == nil {
		upsertThreatIntel(db, domains, "urlhaus", "malware")
	}
	if domains, err := fetchOpenPhish(); err == nil {
		upsertThreatIntel(db, domains, "openphish", "phishing")
	}
}

func fetchURLhaus() ([]string, error) {
	resp, err := feedHTTPClient.Get(urlhausHostfileURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var domains []string
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Hosts-file format: "0.0.0.0 baddomain.com"
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		if d := normalizeDomain(fields[1]); d != "" {
			domains = append(domains, d)
		}
	}
	return domains, scanner.Err()
}

func fetchOpenPhish() ([]string, error) {
	resp, err := feedHTTPClient.Get(openPhishFeedURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var domains []string
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		u, err := url.Parse(line)
		if err != nil || u.Hostname() == "" {
			continue
		}
		if d := normalizeDomain(u.Hostname()); d != "" {
			domains = append(domains, d)
		}
	}
	return domains, scanner.Err()
}

func normalizeDomain(d string) string {
	d = strings.ToLower(strings.TrimSpace(d))
	d = strings.TrimPrefix(d, "www.")
	if d == "" || d == "localhost" || !strings.Contains(d, ".") {
		return ""
	}
	return d
}

func upsertThreatIntel(db *gorm.DB, domains []string, source, category string) {
	now := time.Now()

	// The same domain routinely appears many times in these feeds (one
	// hosting domain serving many malware/phishing URLs) — Postgres's
	// ON CONFLICT DO UPDATE errors ("cannot affect row a second time") if a
	// single INSERT statement targets the same conflicting row twice, so
	// dedupe before batching.
	seen := make(map[string]bool, len(domains))
	unique := make([]models.ThreatIntelDomain, 0, len(domains))
	for _, d := range domains {
		if seen[d] {
			continue
		}
		seen[d] = true
		unique = append(unique, models.ThreatIntelDomain{
			Domain:     d,
			Source:     source,
			Category:   category,
			LastSeenAt: now,
		})
	}

	for start := 0; start < len(unique); start += 500 {
		end := start + 500
		if end > len(unique) {
			end = len(unique)
		}
		batch := unique[start:end]
		db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "domain"}},
			DoUpdates: clause.AssignmentColumns([]string{"source", "category", "last_seen_at", "updated_at"}),
		}).Create(&batch)
	}
}

// StartFeedSyncLoop runs an immediate sync, then repeats on the given
// interval, for the lifetime of the process.
func StartFeedSyncLoop(db *gorm.DB, interval time.Duration) {
	SyncThreatFeeds(db)
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			SyncThreatFeeds(db)
		}
	}()
}
