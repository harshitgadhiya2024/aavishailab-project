// Package storage persists screenshot images. It has two backends and picks
// one from the environment:
//
//   - R2 (or any S3-compatible object store) when SCREENSHOT_R2_* is set. The
//     client is hand-rolled AWS SigV4 rather than the AWS SDK, matching the
//     rest of this codebase (the clamd, TOTP and JWT clients are all
//     dependency-free) and keeping the binary small.
//   - Local disk otherwise, under SCREENSHOT_LOCAL_DIR (a Docker volume), so
//     the feature works with zero configuration in development and small
//     deployments.
//
// Uploads always go through admin-api, so R2 credentials never reach the
// agent. Reads are handed out as short-lived signed URLs an <img> tag can load
// directly — a presigned R2 GET for the object store, or a tokenised admin-api
// URL for local disk.
package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Backend stores and retrieves image objects by key.
type Backend interface {
	Put(ctx context.Context, key, contentType string, data []byte) error
	// SignedURL returns a URL a browser can GET directly for ttl. For R2 this
	// is a presigned S3 URL; for local disk it is an admin-api media URL with
	// an HMAC token.
	SignedURL(key string, ttl time.Duration) (string, error)
	// Open streams an object back — used only by the local media route; R2
	// serves its own presigned URLs and never hits this.
	Open(ctx context.Context, key string) (io.ReadCloser, string, error)
	// Delete removes an object. Both backends already implemented this for
	// their own screenshot-retention sweeps; exposing it on the interface
	// lets other callers (e.g. replacing/removing an app-catalog icon) reuse
	// it instead of re-deriving a key-to-path mapping of their own.
	Delete(key string) error
	Kind() string
}

// New builds the configured backend. Never errors: a misconfigured R2 falls
// back to local disk with a log line rather than taking screenshots offline.
func New() Backend {
	endpoint := os.Getenv("SCREENSHOT_R2_ENDPOINT")
	bucket := os.Getenv("SCREENSHOT_R2_BUCKET")
	access := os.Getenv("SCREENSHOT_R2_ACCESS_KEY")
	secret := os.Getenv("SCREENSHOT_R2_SECRET_KEY")

	if endpoint != "" && bucket != "" && access != "" && secret != "" {
		region := os.Getenv("SCREENSHOT_R2_REGION")
		if region == "" {
			region = "auto"
		}
		return &r2Backend{
			endpoint:  strings.TrimRight(endpoint, "/"),
			bucket:    bucket,
			accessKey: access,
			secretKey: secret,
			region:    region,
			client:    &http.Client{Timeout: 30 * time.Second},
		}
	}

	dir := os.Getenv("SCREENSHOT_LOCAL_DIR")
	if dir == "" {
		dir = "/data/screenshots"
	}
	return &localBackend{dir: dir, secret: mediaSecret()}
}

func mediaSecret() string {
	if s := os.Getenv("MEDIA_SIGNING_SECRET"); s != "" {
		return s
	}
	// Deterministic dev fallback; production sets a real secret.
	return "dev-insecure-media-signing-secret-change-me"
}

// ─── Local disk ──────────────────────────────────────────────────────────────

type localBackend struct {
	dir    string
	secret string
}

func (b *localBackend) Kind() string { return "local" }

func (b *localBackend) Put(_ context.Context, key, _ string, data []byte) error {
	full := filepath.Join(b.dir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		return err
	}
	return os.WriteFile(full, data, 0o640)
}

func (b *localBackend) Delete(key string) error {
	full := filepath.Join(b.dir, filepath.FromSlash(key))
	if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (b *localBackend) Open(_ context.Context, key string) (io.ReadCloser, string, error) {
	full := filepath.Join(b.dir, filepath.FromSlash(key))
	// Guard against a key climbing out of the media directory.
	if !strings.HasPrefix(filepath.Clean(full), filepath.Clean(b.dir)+string(os.PathSeparator)) {
		return nil, "", fmt.Errorf("invalid key")
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, "", err
	}
	return f, contentTypeForKey(key), nil
}

// contentTypeForKey infers Content-Type from the key's own extension.
// Every screenshot key ends in ".webp" (see screenshotKey in
// handlers/monitoring_ingest.go), so that stays the fallback and existing
// screenshots are unaffected — but other object kinds sharing this same
// backend (e.g. app-catalog icons, which can be .png/.svg/.jpg) need their
// real type served, not a hardcoded one a browser may refuse to decode.
func contentTypeForKey(key string) string {
	if ct := mime.TypeByExtension(filepath.Ext(key)); ct != "" {
		return ct
	}
	return "image/webp"
}

// SignedURL for local disk points back at admin-api's public media route with
// an expiring HMAC over key+deadline, so an <img> can load it without an
// Authorization header while the object store stays private.
func (b *localBackend) SignedURL(key string, ttl time.Duration) (string, error) {
	exp := time.Now().Add(ttl).Unix()
	token := b.token(key, exp)
	base := strings.TrimRight(os.Getenv("PUBLIC_API_URL"), "/")
	q := url.Values{"key": {key}, "exp": {fmt.Sprint(exp)}, "sig": {token}}
	return base + "/media/screenshot?" + q.Encode(), nil
}

func (b *localBackend) token(key string, exp int64) string {
	mac := hmac.New(sha256.New, []byte(b.secret))
	fmt.Fprintf(mac, "%s\n%d", key, exp)
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyLocalToken is used by the public media route to validate a signed URL.
func VerifyLocalToken(key, sig string, exp int64) bool {
	b := &localBackend{secret: mediaSecret()}
	if time.Now().Unix() > exp {
		return false
	}
	want := b.token(key, exp)
	return hmac.Equal([]byte(want), []byte(sig))
}

// LocalDir exposes the configured directory for the media route to stream from.
func LocalDir() string {
	if dir := os.Getenv("SCREENSHOT_LOCAL_DIR"); dir != "" {
		return dir
	}
	return "/data/screenshots"
}

// ─── R2 / S3 (hand-rolled SigV4) ─────────────────────────────────────────────

type r2Backend struct {
	endpoint  string
	bucket    string
	accessKey string
	secretKey string
	region    string
	client    *http.Client
}

func (b *r2Backend) Kind() string { return "r2" }

func (b *r2Backend) Delete(key string) error {
	req, err := http.NewRequest(http.MethodDelete, b.objectURL(key), nil)
	if err != nil {
		return err
	}
	b.signV4(req, nil)
	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("r2 delete %s: %d", key, resp.StatusCode)
	}
	return nil
}

func (b *r2Backend) objectURL(key string) string {
	return b.endpoint + "/" + b.bucket + "/" + s3EscapePath(key)
}

func (b *r2Backend) Put(ctx context.Context, key, contentType string, data []byte) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, b.objectURL(key), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = int64(len(data))
	b.signV4(req, data)

	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("r2 put %s: %d %s", key, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// Open is unused for R2 (SignedURL hands out direct presigned links) but must
// satisfy the interface; fetching through admin-api would defeat the point.
func (b *r2Backend) Open(ctx context.Context, key string) (io.ReadCloser, string, error) {
	u, err := b.SignedURL(key, 5*time.Minute)
	if err != nil {
		return nil, "", err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	resp, err := b.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode/100 != 2 {
		resp.Body.Close()
		return nil, "", fmt.Errorf("r2 get %s: %d", key, resp.StatusCode)
	}
	return resp.Body, resp.Header.Get("Content-Type"), nil
}

// SignedURL builds a presigned GET (query-string SigV4). The browser loads it
// directly from R2, so screenshot bytes never transit admin-api on read.
func (b *r2Backend) SignedURL(key string, ttl time.Duration) (string, error) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	host := hostOf(b.endpoint)
	scope := dateStamp + "/" + b.region + "/s3/aws4_request"

	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", b.accessKey+"/"+scope)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", fmt.Sprint(int(ttl.Seconds())))
	q.Set("X-Amz-SignedHeaders", "host")

	canonicalURI := "/" + b.bucket + "/" + s3EscapePath(key)
	canonicalQuery := encodeQuerySorted(q)
	canonicalHeaders := "host:" + host + "\n"
	canonicalRequest := strings.Join([]string{
		http.MethodGet, canonicalURI, canonicalQuery, canonicalHeaders, "host", "UNSIGNED-PAYLOAD",
	}, "\n")

	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signature := hex.EncodeToString(hmacSHA256(b.signingKey(dateStamp), []byte(stringToSign)))
	q.Set("X-Amz-Signature", signature)

	return b.endpoint + canonicalURI + "?" + encodeQuerySorted(q), nil
}

// signV4 signs a request with header-based SigV4 (used for PUT).
func (b *r2Backend) signV4(req *http.Request, payload []byte) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	host := req.URL.Host
	payloadHash := sha256Hex(payload)

	req.Header.Set("Host", host)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)

	signedHeaders := "content-type;host;x-amz-content-sha256;x-amz-date"
	canonicalHeaders := strings.Join([]string{
		"content-type:" + req.Header.Get("Content-Type"),
		"host:" + host,
		"x-amz-content-sha256:" + payloadHash,
		"x-amz-date:" + amzDate,
	}, "\n") + "\n"

	canonicalURI := req.URL.EscapedPath()
	canonicalRequest := strings.Join([]string{
		req.Method, canonicalURI, "", canonicalHeaders, signedHeaders, payloadHash,
	}, "\n")

	scope := dateStamp + "/" + b.region + "/s3/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signature := hex.EncodeToString(hmacSHA256(b.signingKey(dateStamp), []byte(stringToSign)))
	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		b.accessKey, scope, signedHeaders, signature))
}

func (b *r2Backend) signingKey(dateStamp string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+b.secretKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(b.region))
	kService := hmacSHA256(kRegion, []byte("s3"))
	return hmacSHA256(kService, []byte("aws4_request"))
}

// ─── SigV4 helpers ───────────────────────────────────────────────────────────

func hmacSHA256(key, data []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(data)
	return m.Sum(nil)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hostOf(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	return u.Host
}

// s3EscapePath encodes a key the way SigV4 expects: every segment percent-
// encoded, but the slashes between segments preserved.
func s3EscapePath(key string) string {
	parts := strings.Split(key, "/")
	for i, p := range parts {
		parts[i] = s3Escape(p)
	}
	return strings.Join(parts, "/")
}

// s3Escape is RFC 3986 unreserved-only encoding — S3's canonicalisation rules
// are stricter than Go's url.QueryEscape (which leaves +, *, etc. alone).
func s3Escape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func encodeQuerySorted(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		for _, v := range q[k] {
			parts = append(parts, s3Escape(k)+"="+s3Escape(v))
		}
	}
	return strings.Join(parts, "&")
}
