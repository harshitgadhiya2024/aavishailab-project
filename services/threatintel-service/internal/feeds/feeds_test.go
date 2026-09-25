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

// The hostfile kind exists because the URL kind, pointed at URLhaus's
// text_online feed, blocked GitHub and Google Drive on every device in
// production: it reduced "one bad file on a shared host" to "this host is
// malicious". These two tests pin both halves of that lesson — the format
// parses, and a URL-with-a-path never becomes a domain block through it.
func TestHostfileKindLoadsHostsAndNotURLPaths(t *testing.T) {
	sources := []Source{{"urlhaus", "malware", "u://hostfile", "hostfile"}}
	f := fakeFetcher{
		"u://hostfile": "# abuse.ch URLhaus Host file\n#\n0.0.0.0 evil-dropper.com\n0.0.0.0 www.bad-host.net\n\nmalformed-line-without-ip\n",
	}
	s := store.New()
	Sync(s, f, sources)

	if _, ok := s.LookupDomain("evil-dropper.com"); !ok {
		t.Fatal("expected evil-dropper.com loaded from a hosts-file line")
	}
	if _, ok := s.LookupDomain("bad-host.net"); !ok {
		t.Fatal("expected bad-host.net (www stripped) loaded")
	}
	if _, ok := s.LookupDomain("malformed-line-without-ip"); ok {
		t.Fatal("a line that is not <ip> <host> must be skipped, not guessed at")
	}
	if c := s.Counts(); c.Domains != 2 {
		t.Fatalf("expected exactly the 2 well-formed hosts, got %+v", c)
	}
}

func TestHostfileKindIgnoresMalwareURLsOnSharedHosts(t *testing.T) {
	// The exact shape of the production incident: a real URLhaus URL
	// naming one malicious file inside a legitimate host. Whatever else
	// this feed does, it must not come out the other side as "github.com
	// is malware".
	sources := []Source{{"urlhaus", "malware", "u://hostfile", "hostfile"}}
	f := fakeFetcher{
		"u://hostfile": "https://github.com/someone/repo/releases/download/v1/payload.exe\n" +
			"https://raw.githubusercontent.com/someone/repo/main/dropper.ps1\n",
	}
	s := store.New()
	Sync(s, f, sources)

	for _, host := range []string{"github.com", "raw.githubusercontent.com"} {
		if _, ok := s.LookupDomain(host); ok {
			t.Fatalf("%s must never be blocked because a URL on it was listed", host)
		}
	}
	if c := s.Counts(); c.Domains != 0 {
		t.Fatalf("expected nothing loaded from URL lines, got %+v", c)
	}
}

func TestExtractDomain(t *testing.T) {
	cases := map[string]string{
		"http://a.com/x":  "a.com",
		"https://b.co":    "b.co",
		"bare-domain.org": "bare-domain.org",
		"c.com/path/here": "c.com",
		"not a domain":    "",
	}
	for in, want := range cases {
		if got := extractDomain(in); got != want {
			t.Errorf("extractDomain(%q)=%q want %q", in, got, want)
		}
	}
}
