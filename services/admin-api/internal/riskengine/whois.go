package riskengine

import (
	"bufio"
	"fmt"
	"net"
	"regexp"
	"strings"
	"time"
)

// Minimal WHOIS client (raw WHOIS protocol, RFC 3912 — plain text over TCP
// port 43, no library/API needed). Used only to estimate domain age: a
// domain registered a few days ago is a strong phishing/malware signal that
// legitimate long-lived reputation feeds won't have caught yet.

// wellKnownWhoisServers avoids the extra IANA referral round-trip for the
// TLDs that make up the overwhelming majority of real-world traffic.
var wellKnownWhoisServers = map[string]string{
	"com":  "whois.verisign-grs.com",
	"net":  "whois.verisign-grs.com",
	"org":  "whois.pir.org",
	"info": "whois.afilias.net",
	"io":   "whois.nic.io",
	"co":   "whois.nic.co",
	"dev":  "whois.nic.google",
	"app":  "whois.nic.google",
	"ai":   "whois.nic.ai",
}

var creationDatePattern = regexp.MustCompile(`(?i)(?:creation date|created on|created|domain registration date|registered on)\s*:\s*(.+)`)

const whoisTimeout = 5 * time.Second

// DomainAgeDays returns how many days ago the domain was registered, or nil
// if that couldn't be determined (unsupported TLD, WHOIS server unreachable,
// unparseable response, privacy-redacted record, etc.) — callers must treat
// nil as "unknown," not "old," since silently scoring an unknown domain as
// safe would be worse than just skipping this one signal.
func DomainAgeDays(domain string) *int {
	server, ok := whoisServerFor(domain)
	if !ok {
		return nil
	}

	raw, err := queryWhois(server, domain)
	if err != nil {
		return nil
	}

	created, ok := parseCreationDate(raw)
	if !ok {
		return nil
	}

	days := int(time.Since(created).Hours() / 24)
	if days < 0 {
		return nil // clock skew / bad parse — don't report a negative age
	}
	return &days
}

func whoisServerFor(domain string) (string, bool) {
	parts := strings.Split(strings.ToLower(domain), ".")
	tld := parts[len(parts)-1]
	if server, ok := wellKnownWhoisServers[tld]; ok {
		return server, true
	}

	// Fall back to asking IANA which server is authoritative for this TLD.
	raw, err := queryWhois("whois.iana.org", tld)
	if err != nil {
		return "", false
	}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "whois:") {
			server := strings.TrimSpace(line[len("whois:"):])
			if server != "" {
				return server, true
			}
		}
	}
	return "", false
}

func queryWhois(server, query string) (string, error) {
	conn, err := net.DialTimeout("tcp", server+":43", whoisTimeout)
	if err != nil {
		return "", err
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(whoisTimeout))
	if _, err := fmt.Fprintf(conn, "%s\r\n", query); err != nil {
		return "", err
	}

	var sb strings.Builder
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		sb.WriteString(scanner.Text())
		sb.WriteByte('\n')
	}
	return sb.String(), nil
}

var whoisDateLayouts = []string{
	time.RFC3339,
	"2006-01-02T15:04:05Z",
	"2006-01-02 15:04:05",
	"2006-01-02",
	"02-Jan-2006",
	"2006.01.02",
	"20060102",
}

func parseCreationDate(raw string) (time.Time, bool) {
	matches := creationDatePattern.FindStringSubmatch(raw)
	if len(matches) < 2 {
		return time.Time{}, false
	}
	value := strings.TrimSpace(matches[1])
	// Some registries return "keys" like "before Aug-1996" (very old bulk
	// migrations) — trim anything after the first whitespace run that isn't
	// part of a recognizable date/time token to keep parsing forgiving.
	for _, layout := range whoisDateLayouts {
		if t, err := time.Parse(layout, value); err == nil {
			return t, true
		}
		// Try just the date-like prefix if the full value has trailing text.
		if len(value) >= len(layout) {
			if t, err := time.Parse(layout, value[:len(layout)]); err == nil {
				return t, true
			}
		}
	}
	return time.Time{}, false
}
