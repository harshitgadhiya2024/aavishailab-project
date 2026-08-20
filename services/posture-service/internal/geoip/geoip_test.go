package geoip

import (
	"os"
	"path/filepath"
	"testing"
)

func writeCSV(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "geo.csv")
	// startIP,endIP,code,name
	data := "# test country ranges\n" +
		"1.0.0.0,1.0.0.255,US,United States\n" +
		"81.2.69.0,81.2.69.255,GB,United Kingdom\n" +
		"203.0.113.0,203.0.113.255,IN,India\n"
	if err := os.WriteFile(p, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPrivateIP(t *testing.T) {
	r := New("").Lookup("192.168.1.10")
	if !r.IsPrivate {
		t.Fatal("192.168.1.10 should be private")
	}
	if New("").Lookup("10.0.0.5").IsPrivate != true {
		t.Fatal("10.0.0.5 should be private")
	}
	if !New("").Lookup("100.64.0.1").IsPrivate {
		t.Fatal("CGNAT 100.64.0.1 should be treated private")
	}
}

func TestPublicResolvesFromCSV(t *testing.T) {
	res := New(writeCSV(t))
	if res.Count() != 3 {
		t.Fatalf("expected 3 ranges, got %d", res.Count())
	}
	uk := res.Lookup("81.2.69.142")
	if uk.CountryCode != "GB" || uk.Country != "United Kingdom" || uk.IsPrivate {
		t.Fatalf("expected GB, got %+v", uk)
	}
	in := res.Lookup("203.0.113.55")
	if in.CountryCode != "IN" {
		t.Fatalf("expected IN, got %+v", in)
	}
}

func TestUnknownPublicIP(t *testing.T) {
	res := New(writeCSV(t))
	r := res.Lookup("8.8.8.8") // not in the fixture
	if r.CountryCode != "" || r.IsPrivate {
		t.Fatalf("expected unknown/empty, got %+v", r)
	}
}

func TestNoCSVStillHandlesPrivate(t *testing.T) {
	res := New("")
	if res.Count() != 0 {
		t.Fatal("expected 0 ranges with no CSV")
	}
	if !res.Lookup("127.0.0.1").IsPrivate {
		t.Fatal("loopback should be private even with no CSV")
	}
	if res.Lookup("81.2.69.142").CountryCode != "" {
		t.Fatal("public IP should be unknown with no CSV")
	}
}

func TestInvalidIP(t *testing.T) {
	r := New("").Lookup("not-an-ip")
	if r.CountryCode != "" || r.IsPrivate {
		t.Fatalf("invalid IP should yield empty result, got %+v", r)
	}
}
