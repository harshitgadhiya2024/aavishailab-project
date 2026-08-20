package dlp

import (
	"strings"

	"github.com/aavishield/admin-api/internal/models"
)

// MaxScanSize is the largest slice this scanner is handed in one call. It is
// no longer a ceiling on what gets scanned: callers spool content of any size
// to disk and walk it in overlapping windows of this size (see
// handlers.scanDLPStream), so a 3GB upload is inspected in full — just not in
// one allocation.
const MaxScanSize = 20 * 1024 * 1024

// Result is the outcome of scanning one piece of content against an org's
// enabled DLP policies.
type Result struct {
	Matched bool
	Action  models.PolicyAction
	Policy  *models.Policy
	Matches []Match
}

// fileCategory buckets a file for the policy-level bypass list (the
// requirement's "Allow: Images, PDFs" — an org can exempt whole categories
// from DLP scanning without disabling detectors for everything else).
func fileCategory(filename, contentType string) string {
	ct := strings.ToLower(contentType)
	name := strings.ToLower(filename)

	switch {
	case strings.HasPrefix(ct, "image/"),
		strings.HasSuffix(name, ".png"), strings.HasSuffix(name, ".jpg"),
		strings.HasSuffix(name, ".jpeg"), strings.HasSuffix(name, ".gif"),
		strings.HasSuffix(name, ".webp"), strings.HasSuffix(name, ".svg"):
		return "image"
	case ct == "application/pdf", strings.HasSuffix(name, ".pdf"):
		return "pdf"
	case strings.Contains(ct, "zip"), strings.Contains(ct, "compressed"),
		strings.HasSuffix(name, ".zip"), strings.HasSuffix(name, ".rar"), strings.HasSuffix(name, ".7z"):
		return "archive"
	default:
		return "document"
	}
}

// rulesFor unmarshals a Policy's flexible jsonb Rules into typed DLP config.
// Missing/malformed fields degrade to "no detectors configured" rather than
// erroring — a policy with a typo'd field shouldn't crash scanning for the
// whole org.
type dlpRules struct {
	Detectors      []Detector
	Keywords       []string
	CustomPatterns []CustomPattern
	BypassFileTypes map[string]bool
}

func parseRules(raw map[string]any) dlpRules {
	r := dlpRules{BypassFileTypes: map[string]bool{}}

	if list, ok := raw["detectors"].([]any); ok {
		for _, v := range list {
			if s, ok := v.(string); ok {
				r.Detectors = append(r.Detectors, Detector(s))
			}
		}
	}
	if list, ok := raw["keywords"].([]any); ok {
		for _, v := range list {
			if s, ok := v.(string); ok {
				r.Keywords = append(r.Keywords, s)
			}
		}
	}
	if list, ok := raw["custom_patterns"].([]any); ok {
		for _, v := range list {
			m, ok := v.(map[string]any)
			if !ok {
				continue
			}
			name, _ := m["name"].(string)
			regex, _ := m["regex"].(string)
			if regex == "" {
				continue
			}
			r.CustomPatterns = append(r.CustomPatterns, CustomPattern{Name: name, Regex: regex})
		}
	}
	if list, ok := raw["bypass_file_types"].([]any); ok {
		for _, v := range list {
			if s, ok := v.(string); ok {
				r.BypassFileTypes[strings.ToLower(s)] = true
			}
		}
	}

	return r
}

// Scan evaluates content against an org's enabled DLP policies, in priority
// order, and returns on the first policy that matches — mirroring the
// first-match-wins semantics PolicyCache.CheckDomain already uses for
// domain rules. Callers must pass only enabled policies of type "dlp",
// pre-sorted by priority ascending (same ordering PolicyHandler.List uses).
func Scan(policies []models.Policy, filename, contentType string, data []byte) Result {
	text := string(data)
	category := fileCategory(filename, contentType)

	for i := range policies {
		p := &policies[i]
		rules := parseRules(p.Rules)

		if rules.BypassFileTypes[category] {
			continue
		}

		var matches []Match
		for _, d := range rules.Detectors {
			switch d {
			case DetectorCreditCard:
				matches = append(matches, DetectCreditCard(text)...)
			case DetectorPAN:
				matches = append(matches, DetectPAN(text)...)
			case DetectorAadhaar:
				matches = append(matches, DetectAadhaar(text)...)
			case DetectorAWSKey:
				matches = append(matches, DetectAWSKey(text)...)
			case DetectorGitHubToken:
				matches = append(matches, DetectGitHubToken(text)...)
			case DetectorGenericAPIKey:
				matches = append(matches, DetectGenericAPIKey(text)...)
			case DetectorSourceCode:
				matches = append(matches, DetectSourceCode(filename)...)
			}
		}
		matches = append(matches, DetectKeywords(text, rules.Keywords)...)
		matches = append(matches, DetectCustomPatterns(text, rules.CustomPatterns)...)

		if len(matches) > 0 {
			return Result{Matched: true, Action: p.Action, Policy: p, Matches: matches}
		}
	}

	return Result{Matched: false, Action: models.PolicyActionAllow}
}
