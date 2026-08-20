// Package heuristics holds pure, dependency-free domain-name signals (ported
// from admin-api's riskengine) — the same class of signal DGA detectors use.
package heuristics

import (
	"math"
	"strings"
)

func shannonEntropy(s string) float64 {
	if s == "" {
		return 0
	}
	counts := map[rune]int{}
	for _, r := range s {
		counts[r]++
	}
	n := float64(len(s))
	var e float64
	for _, c := range counts {
		p := float64(c) / n
		e -= p * math.Log2(p)
	}
	return e
}

func digitRatio(s string) float64 {
	if s == "" {
		return 0
	}
	d := 0
	for _, r := range s {
		if r >= '0' && r <= '9' {
			d++
		}
	}
	return float64(d) / float64(len(s))
}

// DNSAnomalyScore returns 0-15 reflecting how much a domain's structure
// resembles an algorithmically-generated malware domain.
func DNSAnomalyScore(domain string) (int, []string) {
	domain = strings.ToLower(strings.TrimSuffix(domain, "."))
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return 0, nil
	}
	sld := labels[len(labels)-2]

	score := 0
	var reasons []string
	if len(sld) >= 8 && shannonEntropy(sld) >= 3.8 {
		score += 8
		reasons = append(reasons, "high-entropy domain name (looks algorithmically generated)")
	}
	if len(sld) >= 6 && digitRatio(sld) >= 0.4 {
		score += 4
		reasons = append(reasons, "unusually digit-heavy domain name")
	}
	if len(labels) >= 5 {
		score += 3
		reasons = append(reasons, "unusually deep subdomain nesting")
	}
	if score > 15 {
		score = 15
	}
	return score, reasons
}
