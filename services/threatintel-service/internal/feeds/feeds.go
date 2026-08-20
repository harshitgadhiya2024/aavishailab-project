// Package feeds fetches free, no-key threat-intel feeds and loads them into the
// store. Fetching is behind an interface so tests inject fixed content and
// never touch the network.
//
// Sources (all abuse.ch / OpenPhish public feeds, no signup / API key):
//   - URLhaus       (malware distribution URLs -> domains)
//   - OpenPhish     (phishing URLs -> domains)
//   - Feodo Tracker (botnet C2 IP blocklist)
//   - MalwareBazaar (recent malware sample SHA-256 hashes)
package feeds

import (
	"bufio"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aavishield/threatintel-service/internal/store"
)

type Source struct {
	Name     string
	Category string
	URL      string
	Kind     string // domain | ip | hash
}

// DefaultSources are the public feeds synced in production.
var DefaultSources = []Source{
	{"urlhaus", "malware", "https://urlhaus.abuse.ch/downloads/text_online/", "domain"},
	{"openphish", "phishing", "https://openphish.com/feed.txt", "domain"},
	{"feodotracker", "botnet", "https://feodotracker.abuse.ch/downloads/ipblocklist.txt", "ip"},
	{"malwarebazaar", "malware", "https://bazaar.abuse.ch/export/txt/sha256/recent/", "hash"},
}

// Fetcher retrieves a feed's raw body. HTTPFetcher is the real one; tests use
// a fake.
type Fetcher interface {
	Fetch(url string) (io.ReadCloser, error)
}

type HTTPFetcher struct{ Client *http.Client }

func (h HTTPFetcher) Fetch(u string) (io.ReadCloser, error) {
	client := h.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "AavishieldThreatIntel/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, &url.Error{Op: "GET", URL: u, Err: httpStatusErr(resp.StatusCode)}
	}
	return resp.Body, nil
}

type httpStatusErr int

func (e httpStatusErr) Error() string { return "unexpected status " + itoa(int(e)) }

// Sync fetches all sources and loads indicators into s. Per-source failures
// are logged and skipped (a feed outage never wipes existing data).
func Sync(s *store.Store, f Fetcher, sources []Source) {
	for _, src := range sources {
		body, err := f.Fetch(src.URL)
		if err != nil {
			log.Printf("threatintel: feed %s fetch failed: %v", src.Name, err)
			continue
		}
		n := load(s, src, body)
		body.Close()
		log.Printf("threatintel: feed %s loaded %d %s indicator(s)", src.Name, n, src.Kind)
	}
}

func load(s *store.Store, src Source, r io.Reader) int {
	entry := store.Entry{Source: src.Name, Category: src.Category}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	n := 0
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		switch src.Kind {
		case "domain":
			if d := extractDomain(line); d != "" {
				s.SetDomain(d, entry)
				n++
			}
		case "ip":
			// Feodo blocklist is one IP per line (sometimes IP,port,...).
			ip := line
			if idx := strings.IndexAny(ip, ", \t"); idx >= 0 {
				ip = ip[:idx]
			}
			if isIPish(ip) {
				s.SetIP(ip, entry)
				n++
			}
		case "hash":
			if isSHA256(line) {
				s.SetHash(line, entry)
				n++
			}
		}
	}
	return n
}

// extractDomain pulls the host out of a URL or a bare domain line.
func extractDomain(line string) string {
	if strings.Contains(line, "://") {
		if u, err := url.Parse(line); err == nil && u.Hostname() != "" {
			return u.Hostname()
		}
	}
	// bare host (maybe with a path) — take up to the first slash.
	if idx := strings.IndexByte(line, '/'); idx >= 0 {
		line = line[:idx]
	}
	if strings.Contains(line, ".") && !strings.ContainsAny(line, " \t") {
		return line
	}
	return ""
}

func isIPish(s string) bool {
	dots := strings.Count(s, ".")
	colons := strings.Count(s, ":")
	return (dots == 3 || colons >= 2) && !strings.ContainsAny(s, " \t")
}

func isSHA256(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
