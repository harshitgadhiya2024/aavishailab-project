package policy

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Rule struct {
	ID       string `json:"id"`
	Domain   string `json:"domain"`
	Action   string `json:"action"` // block, allow, alert
	Category string `json:"category"`
	OrgID    string `json:"org_id"`
	Reason   string `json:"reason"`
}

type PolicyCache struct {
	mu          sync.RWMutex
	rules       []Rule
	rulesByDomain map[string][]Rule // domain → rules
	adminAPIURL string
	lastRefresh time.Time
	totalRules  int
}

func NewCache(adminAPIURL string) *PolicyCache {
	return &PolicyCache{
		adminAPIURL:   adminAPIURL,
		rulesByDomain: make(map[string][]Rule),
	}
}

func (c *PolicyCache) Refresh() error {
	url := c.adminAPIURL + "/internal/swg/rules"
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("failed to fetch rules: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var rules []Rule
	if err := json.Unmarshal(body, &rules); err != nil {
		return fmt.Errorf("failed to parse rules: %w", err)
	}

	index := make(map[string][]Rule)
	for _, r := range rules {
		domain := strings.ToLower(r.Domain)
		index[domain] = append(index[domain], r)
	}

	c.mu.Lock()
	c.rules = rules
	c.rulesByDomain = index
	c.totalRules = len(rules)
	c.lastRefresh = time.Now()
	c.mu.Unlock()

	return nil
}

// CheckDomain returns the most specific matching rule for a domain
// Checks exact match, then *.parent wildcards
func (c *PolicyCache) CheckDomain(domain, orgID string) *Rule {
	c.mu.RLock()
	defer c.mu.RUnlock()

	domain = strings.ToLower(strings.TrimPrefix(domain, "www."))

	// Check exact match (org-specific rules take priority)
	if rules, ok := c.rulesByDomain[domain]; ok {
		// Org-specific rule first
		for _, r := range rules {
			if r.OrgID == orgID {
				return &r
			}
		}
		// Global rule (empty org_id)
		for _, r := range rules {
			if r.OrgID == "" {
				return &r
			}
		}
	}

	// Walk parent domains (e.g. cdn.instagram.com → instagram.com).
	// Skip single-label parents like "com" to avoid blocking entire TLDs.
	parts := strings.Split(domain, ".")
	for i := 1; i < len(parts); i++ {
		parent := strings.Join(parts[i:], ".")
		if !strings.Contains(parent, ".") {
			continue
		}
		if rules, ok := c.rulesByDomain[parent]; ok {
			for _, r := range rules {
				if r.OrgID == orgID {
					return &r
				}
			}
			for _, r := range rules {
				if r.OrgID == "" {
					return &r
				}
			}
		}
	}

	return nil
}

func (c *PolicyCache) StartAutoRefresh(intervalSeconds int) {
	ticker := time.NewTicker(time.Duration(intervalSeconds) * time.Second)
	for range ticker.C {
		if err := c.Refresh(); err != nil {
			fmt.Printf("Policy cache refresh error: %v\n", err)
		}
	}
}

func (c *PolicyCache) Stats() map[string]any {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return map[string]any{
		"total_rules":  c.totalRules,
		"last_refresh": c.lastRefresh,
	}
}
