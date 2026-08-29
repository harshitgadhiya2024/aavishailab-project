// Package extractclient calls the standalone extract-service (deep content
// extraction: CSV/JSON/DOCX/XLSX/PPTX/PDF/ZIP/TAR/7z/images/OCR/RTF/legacy
// Office/.eml/multipart) and streams back NDJSON segments as they're
// produced. admin-api stays the orchestrator (policy, scoring via
// dlpclient, budget, incident logging); extract-service is pure,
// stateless, horizontally-scalable extraction.
//
// If EXTRACT_SERVICE_URL is unset, Enabled() is false and callers fall back
// to scanning raw bytes directly — the same "degrade, don't break" pattern
// dlpclient already uses for dlp-service.
package extractclient

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// Item is one line of extract-service's NDJSON response. Only the fields
// relevant to the current "kind" are populated; the rest are zero values.
type Item struct {
	Kind     string `json:"kind"`
	Seq      int    `json:"seq"`
	Part     string `json:"part"`
	Filename string `json:"filename"`
	Mime     string `json:"mime"`
	Source   string `json:"source"`
	Text     string `json:"text"`

	// kind == "unscannable"
	Reason string `json:"reason"`
	Detail string `json:"detail"`

	// kind == "image"
	SHA256  string `json:"sha256"`
	W       int    `json:"w"`
	H       int    `json:"h"`
	B64     string `json:"b64"`
	OCRText string `json:"ocr_text"`

	// kind == "summary"
	Parts     int   `json:"parts"`
	BytesIn   int64 `json:"bytes_in"`
	Complete  bool  `json:"complete"`
	ElapsedMs int   `json:"elapsed_ms"`
	OCRPages  int   `json:"ocr_pages"`
	OCRImages int   `json:"ocr_images"`
	Images    int   `json:"images"`
}

// otelhttp.NewTransport joins whatever trace the inbound scan request
// started, same convention as dlpclient.
var httpClient = &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}

func serviceURL() string {
	return strings.TrimRight(os.Getenv("EXTRACT_SERVICE_URL"), "/")
}

func secret() string {
	s := os.Getenv("EXTRACT_SERVICE_SECRET")
	if s == "" {
		s = "dev-insecure-extract-secret-change-me"
	}
	return s
}

// Enabled reports whether an extract-service endpoint is configured.
func Enabled() bool { return serviceURL() != "" }

// MintToken mirrors dlpclient.MintToken byte-for-byte — extract-service's
// auth.py/verify_token expects the identical v1.<payload>.<sig> shape.
func MintToken(orgID string, ttl time.Duration) string {
	payload, _ := json.Marshal(map[string]any{
		"iss":    "admin-api",
		"org_id": orgID,
		"exp":    time.Now().Add(ttl).Unix(),
	})
	mac := hmac.New(sha256.New, []byte(secret()))
	mac.Write(payload)
	sig := mac.Sum(nil)
	enc := base64.RawURLEncoding
	return "v1." + enc.EncodeToString(payload) + "." + enc.EncodeToString(sig)
}

// maxLineBytes bounds a single NDJSON line — mainly to cap a runaway image
// record (base64 image payloads are already downscaled server-side to a
// few hundred KB, so a few MB of headroom comfortably covers a legitimate
// line while still refusing an unbounded one).
const maxLineBytes = 8 * 1024 * 1024

// Stream posts `body` (size bytes) to extract-service's /v1/extract and
// invokes onItem for every "segment"/"image"/"unscannable" line as it
// arrives, in order. If onItem returns true, the connection is closed
// immediately — extract-service's generator observes the client hangup and
// stops walking the rest of the content right there, exactly like a `block`
// verdict already stops admin-api's own raw-byte window loop early.
//
// Returns the terminal "summary" item (zero Item if the stream ended
// without one — e.g. the caller stopped early) and any transport error.
func Stream(ctx context.Context, orgID, filename, contentType string, body io.Reader, size int64,
	ocrEnabled, imagesEnabled bool, deadline time.Duration, onItem func(Item) (stop bool)) (Item, error) {

	q := url.Values{}
	q.Set("org_id", orgID)
	q.Set("filename", filename)
	q.Set("content_type", contentType)
	q.Set("ocr", strconv.FormatBool(ocrEnabled))
	q.Set("images", strconv.FormatBool(imagesEnabled))
	if deadline > 0 {
		q.Set("deadline_ms", strconv.FormatInt(deadline.Milliseconds(), 10))
	}

	// Wrap body in io.NopCloser even though it may already be an io.Closer
	// (the caller's spooled *os.File almost always is): net/http special-
	// cases a body that implements io.Closer and uses it AS THE REQUEST
	// BODY DIRECTLY, and the transport closes that on request teardown —
	// including on a failed dial, before this function ever gets a chance
	// to return. Without this wrapper, a network error here silently
	// closes the caller's spool file out from under it, breaking the
	// raw-byte fallback path callers rely on when extract-service is
	// unreachable.
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL()+"/v1/extract?"+q.Encode(), io.NopCloser(body))
	if err != nil {
		return Item{}, err
	}
	req.ContentLength = size
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Authorization", "Bearer "+MintToken(orgID, 5*time.Minute))

	resp, err := httpClient.Do(req)
	if err != nil {
		return Item{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return Item{}, fmt.Errorf("extract-service returned %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), maxLineBytes)

	var summary Item
	for scanner.Scan() {
		var it Item
		if err := json.Unmarshal(scanner.Bytes(), &it); err != nil {
			// A single malformed line shouldn't take the whole scan down —
			// extract-service already isolates per-part failures into
			// "unscannable" records; a truly malformed line here is a
			// transport/serialization bug worth surviving, not fatal.
			continue
		}
		if it.Kind == "summary" {
			summary = it
			break
		}
		if onItem(it) {
			return summary, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return summary, err
	}
	return summary, nil
}
