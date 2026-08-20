package feeds

import (
	"io"
	"strings"
	"testing"

	"github.com/aavishield/threatintel-service/internal/store"
)

// fakeFetcher returns canned feed bodies keyed by URL — no network.
type fakeFetcher map[string]string

func (f fakeFetcher) Fetch(u string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader(f[u])), nil
}

func TestSyncLoadsAllKinds(t *testing.T) {
	sources := []Source{
		{"urlhaus", "malware", "u://domains", "domain"},
		{"feodotracker", "botnet", "u://ips", "ip"},
		{"malwarebazaar", "malware", "u://hashes", "hash"},
	}
	f := fakeFetcher{
		"u://domains": "# comment\nhttp://bad-malware.com/payload.exe\nwww.evil.net/x\n\n",
		"u://ips":     "# Feodo\n203.0.113.5\n198.51.100.9,447,online\n",
		"u://hashes":  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nnot-a-hash\n",
	}
	s := store.New()
	Sync(s, f, sources)

	if _, ok := s.LookupDomain("bad-malware.com"); !ok {
		t.Fatal("expected bad-malware.com loaded from URL line")
	}
	if _, ok := s.LookupDomain("evil.net"); !ok {
		t.Fatal("expected evil.net (www stripped) loaded")
	}
	if _, ok := s.LookupIP("203.0.113.5"); !ok {
		t.Fatal("expected IP loaded")
	}
	if _, ok := s.LookupIP("198.51.100.9"); !ok {
		t.Fatal("expected IP with trailing port stripped")
	}
	if _, ok := s.LookupHash("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); !ok {
		t.Fatal("expected sha256 loaded")
	}
	c := s.Counts()
	if c.Domains != 2 || c.IPs != 2 || c.Hashes != 1 {
		t.Fatalf("unexpected counts: %+v", c)
	}
}

func TestExtractDomain(t *testing.T) {
	cases := map[string]string{
		"http://a.com/x":   "a.com",
		"https://b.co":     "b.co",
		"bare-domain.org":  "bare-domain.org",
		"c.com/path/here":  "c.com",
		"not a domain":     "",
	}
	for in, want := range cases {
		if got := extractDomain(in); got != want {
			t.Errorf("extractDomain(%q)=%q want %q", in, got, want)
		}
	}
}
