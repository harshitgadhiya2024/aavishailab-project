package riskengine

import (
	"math"
	"strings"
)

// Pure algorithmic heuristics — no external calls, no dependencies. These
// are the same class of signal DGA (domain generation algorithm) detectors
// use: malware that mints thousands of random-looking domains per day tends
// to produce names with unusually high character entropy, heavy digit use,
// or excessive subdomain nesting, none of which normal marketing-chosen
// domain names exhibit.

// shannonEntropy returns the Shannon entropy (bits per character) of s.
// Random strings score high (~4+ for a 26-letter alphabet); real words and
// brand names score lower because letter frequency is skewed.
func shannonEntropy(s string) float64 {
	if s == "" {
		return 0
	}
	counts := make(map[rune]int)
	for _, r := range s {
		counts[r]++
	}
	length := float64(len(s))
	var entropy float64
	for _, c := range counts {
		p := float64(c) / length
		entropy -= p * math.Log2(p)
	}
	return entropy
}

func digitRatio(s string) float64 {
	if s == "" {
		return 0
	}
	digits := 0
	for _, r := range s {
		if r >= '0' && r <= '9' {
			digits++
		}
	}
	return float64(digits) / float64(len(s))
}

// DNSAnomalyScore returns 0-15: a small contribution reflecting how much a
// domain's structure resembles algorithmically-generated malware domains
// rather than a normal, human-chosen name.
func DNSAnomalyScore(domain string) (score int, reasons []string) {
	domain = strings.ToLower(strings.TrimSuffix(domain, "."))
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return 0, nil
	}

	// The registrable label (e.g. "example" in "example.com"), which is
	// where DGA malware puts its randomness — not the TLD.
	sld := labels[len(labels)-2]

	if len(sld) >= 8 {
		entropy := shannonEntropy(sld)
		if entropy >= 3.8 {
			score += 8
			reasons = append(reasons, "high-entropy domain name (looks algorithmically generated)")
		}
	}

	if ratio := digitRatio(sld); ratio >= 0.4 && len(sld) >= 6 {
		score += 4
		reasons = append(reasons, "unusually digit-heavy domain name")
	}

	// Excess subdomain depth is a common phishing trick (e.g.
	// "login.security.appleid.example-verify.com").
	if len(labels) >= 5 {
		score += 3
		reasons = append(reasons, "unusually deep subdomain nesting")
	}

	if score > 15 {
		score = 15
	}
	return score, reasons
}
