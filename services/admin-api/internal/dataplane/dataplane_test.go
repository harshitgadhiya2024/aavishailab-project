package dataplane

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"

	"github.com/aavishield/admin-api/internal/models"
)

func TestSealRoundTripAndTamper(t *testing.T) {
	t.Setenv("CA_KEY_ENCRYPTION_KEY", "test-only-key-for-sealing-0123456789abcdef")
	sealed, err := Seal([]byte(`{"password":"hunter2"}`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "hunter2") || !strings.HasPrefix(sealed, sealPrefix) {
		t.Fatalf("sealed value leaks or lacks its version: %q", sealed)
	}
	got, err := Open(sealed)
	if err != nil || string(got) != `{"password":"hunter2"}` {
		t.Fatalf("round trip = %q, %v", got, err)
	}
	// Two seals of the same input differ (random nonce).
	again, _ := Seal([]byte(`{"password":"hunter2"}`))
	if again == sealed {
		t.Fatal("sealing is deterministic — the nonce is not random")
	}
	// A flipped byte must fail authentication, not decrypt to garbage.
	b := []byte(sealed)
	b[len(b)-3] ^= 1
	if _, err := Open(string(b)); err == nil {
		t.Fatal("tampered ciphertext was accepted")
	}
	// A different server key cannot open it.
	t.Setenv("CA_KEY_ENCRYPTION_KEY", "another-key-entirely-0123456789abcdefghij")
	if _, err := Open(sealed); err == nil {
		t.Fatal("opened with the wrong key")
	}
}

func TestPublicIP(t *testing.T) {
	for _, ip := range []string{
		"127.0.0.1", "10.1.2.3", "172.17.0.2", "192.168.1.10", "169.254.169.254",
		"100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
	} {
		if publicIP(net.ParseIP(ip)) {
			t.Errorf("%s must be refused", ip)
		}
	}
	for _, ip := range []string{"8.8.8.8", "52.95.110.1", "2606:4700:4700::1111"} {
		if !publicIP(net.ParseIP(ip)) {
			t.Errorf("%s must be allowed", ip)
		}
	}
}

func TestGuardedDialRefusesPrivateAddresses(t *testing.T) {
	t.Setenv("DATA_RESIDENCY_ALLOW_PRIVATE_NETWORKS", "")
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	_, err = guardedDialContext(context.Background(), "tcp", ln.Addr().String())
	var priv ErrPrivateAddress
	if !errors.As(err, &priv) {
		t.Fatalf("dial to loopback = %v, want ErrPrivateAddress", err)
	}
	if err := checkHostResolvable(context.Background(), "localhost"); err == nil {
		t.Fatal("localhost must be refused up front")
	}

	t.Setenv("DATA_RESIDENCY_ALLOW_PRIVATE_NETWORKS", "true")
	conn, err := guardedDialContext(context.Background(), "tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("with the override, loopback should be reachable: %v", err)
	}
	conn.Close()
}

func TestDBConfigValidation(t *testing.T) {
	c := DBConfig{Provider: "mysql", Host: "db.example.com", Database: "aavishield", Username: "app", Password: "x"}
	c.Normalize()
	if err := c.Validate(); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	if c.Port != 3306 || c.TLS != "require" {
		t.Fatalf("defaults not applied: port=%d tls=%q", c.Port, c.TLS)
	}

	bad := DBConfig{Provider: "postgres", Host: "db.example.com/evil", Database: "a; DROP", Schema: "x y"}
	bad.Normalize()
	err := bad.Validate()
	var fe FieldErrors
	if !errors.As(err, &fe) {
		t.Fatalf("want field errors, got %v", err)
	}
	for _, f := range []string{"host", "database", "username", "password", "schema"} {
		if fe[f] == "" {
			t.Errorf("missing error for %s", f)
		}
	}

	m := DBConfig{Provider: "mongodb", URI: "mongodb+srv://u:p@cluster0.example.net/?retryWrites=true", Database: "aavishield"}
	m.Normalize()
	if err := m.Validate(); err != nil {
		t.Fatalf("mongo URI rejected: %v", err)
	}
	if s := m.Summary()["uri"].(string); strings.Contains(s, ":p@") {
		t.Fatalf("summary leaks the password: %s", s)
	}
}

func TestDBConfigMergeSecrets(t *testing.T) {
	prev := &DBConfig{Provider: "postgres", Host: "h", Username: "u", Password: "secret"}
	next := &DBConfig{Provider: "postgres", Host: "h", Username: "u"}
	next.MergeSecrets(prev)
	if next.Password != "secret" {
		t.Fatal("a blank password should keep the saved one")
	}
	// Pointing at another server must not carry the old password along.
	moved := &DBConfig{Provider: "postgres", Host: "other", Username: "u"}
	moved.MergeSecrets(prev)
	if moved.Password != "" {
		t.Fatal("the saved password leaked to a different host")
	}
	m := &DBConfig{Provider: "mongodb", URI: "mongodb://u:pw@h:27017/"}
	again := &DBConfig{Provider: "mongodb", URI: redactURI(m.URI)}
	again.MergeSecrets(m)
	if again.URI != m.URI {
		t.Fatal("an unchanged (redacted) URI should keep the saved one")
	}
}

func TestFilesConfigValidation(t *testing.T) {
	cases := []FilesConfig{
		{Provider: models.ResidencyFilesS3, Bucket: "acme-aavishield", Region: "ap-south-1", AccessKeyID: "AKIA", SecretAccessKey: "s"},
		{Provider: models.ResidencyFilesR2, Bucket: "acme", AccountID: strings.Repeat("a", 32), AccessKeyID: "k", SecretAccessKey: "s"},
		{Provider: models.ResidencyFilesGCS, Bucket: "acme", AccessKeyID: "GOOG", SecretAccessKey: "s"},
		{Provider: models.ResidencyFilesS3Compatible, Bucket: "acme", Endpoint: "https://s3.wasabisys.com", AccessKeyID: "k", SecretAccessKey: "s"},
		{Provider: models.ResidencyFilesAzure, AccountName: "acmestore", AccountKey: "a2V5", Container: "aavishield"},
	}
	for _, c := range cases {
		c.Normalize()
		if err := c.Validate(); err != nil {
			t.Errorf("%s rejected: %v", c.Provider, err)
		}
	}
	if (&FilesConfig{Provider: "dropbox"}).Validate() == nil {
		t.Error("unknown provider accepted")
	}
	r2 := FilesConfig{Provider: models.ResidencyFilesR2, AccountID: strings.Repeat("b", 32)}
	if got := r2.endpoint(); got != "https://"+strings.Repeat("b", 32)+".r2.cloudflarestorage.com" {
		t.Errorf("r2 endpoint = %s", got)
	}
	s3 := FilesConfig{Provider: models.ResidencyFilesS3, Region: "eu-west-1", AccessKeyID: "AKIAXXXXXXXX1234"}
	if s3.endpoint() != "https://s3.eu-west-1.amazonaws.com" {
		t.Errorf("s3 endpoint = %s", s3.endpoint())
	}
	if s := s3.Summary()["access_key_id"].(string); strings.Contains(s, "AKIAXXXX") || !strings.HasSuffix(s, "1234") {
		t.Errorf("access key not masked: %s", s)
	}
}

func TestNormalizeDedupeKey(t *testing.T) {
	short := "web|example.com"
	if normalizeDedupeKey(short) != short {
		t.Fatal("short keys must be unchanged")
	}
	long := "dlp-file|" + strings.Repeat("x", 500)
	a, b := normalizeDedupeKey(long), normalizeDedupeKey(long)
	if a != b || len(a) > 255 {
		t.Fatalf("long key must hash stably and fit the column: %d chars", len(a))
	}
	if normalizeDedupeKey(long+"y") == a {
		t.Fatal("different keys collided")
	}
}

func TestNormalizeBSONShapes(t *testing.T) {
	in := map[string]any{"n": int32(3), "list": []any{int64(1), "a"}}
	out := normalizeBSON(in).(map[string]any)
	if out["n"] != float64(3) {
		t.Errorf("int32 → %T", out["n"])
	}
	if l, ok := out["list"].([]any); !ok || l[0] != float64(1) {
		t.Errorf("list → %#v", out["list"])
	}
}
