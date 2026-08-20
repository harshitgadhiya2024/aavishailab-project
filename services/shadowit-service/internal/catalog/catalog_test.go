package catalog

import (
	"os"
	"path/filepath"
	"testing"
)

func TestClassifyKnownApp(t *testing.T) {
	c := New()
	r := c.Classify("dropbox.com")
	if !r.Matched || r.App != "Dropbox" || r.Category != "cloud_storage" {
		t.Fatalf("expected Dropbox, got %+v", r)
	}
	if r.RiskScore == 0 {
		t.Fatal("expected non-zero risk")
	}
}

func TestClassifySubdomain(t *testing.T) {
	c := New()
	r := c.Classify("api.dropbox.com")
	if !r.Matched || r.App != "Dropbox" {
		t.Fatalf("subdomain should hit parent, got %+v", r)
	}
	if !c.Classify("www.dropbox.com").Matched {
		t.Fatal("www prefix should hit")
	}
}

func TestClassifyUnknown(t *testing.T) {
	r := New().Classify("some-random-internal-tool.example")
	if r.Matched {
		t.Fatalf("expected no match, got %+v", r)
	}
	if r.Category != "unknown" || r.RiskScore != 0 {
		t.Fatalf("unknown should be category unknown/0, got %+v", r)
	}
}

func TestClassifyAITool(t *testing.T) {
	r := New().Classify("chat.openai.com")
	if !r.Matched || r.Category != "ai_tools" {
		t.Fatalf("expected ai_tools, got %+v", r)
	}
}

func TestOverrideExtendsCatalog(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "cat.json")
	os.WriteFile(p, []byte(`{"internal-wiki.acme.com":{"app":"Acme Wiki","category":"productivity"}}`), 0o600)
	c := New()
	before := c.Size()
	if err := c.LoadOverride(p); err != nil {
		t.Fatal(err)
	}
	if c.Size() != before+1 {
		t.Fatalf("expected catalog to grow by 1, got %d->%d", before, c.Size())
	}
	r := c.Classify("internal-wiki.acme.com")
	if !r.Matched || r.App != "Acme Wiki" {
		t.Fatalf("override not applied: %+v", r)
	}
	// risk_score omitted -> derived from category (productivity=38)
	if r.RiskScore != 38 {
		t.Fatalf("expected derived risk 38, got %d", r.RiskScore)
	}
}
