// Package dlpclient calls the standalone dlp-service (content scanning +
// weighted sensitivity scoring). admin-api stays the control plane and event
// store; dlp-service is stateless compute. If DLP_SERVICE_URL is unset the
// caller falls back to the in-process dlp package, so the platform still
// enforces DLP even when the microservice isn't deployed.
package dlpclient

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// CustomPattern mirrors an org-defined named regex.
type CustomPattern struct {
	Name  string `json:"name"`
	Regex string `json:"regex"`
}

// PolicyEnvelope is one DLP policy flattened into what dlp-service needs. It
// intentionally carries no DB types — just the scanning config.
type PolicyEnvelope struct {
	Name            string          `json:"name"`
	Action          string          `json:"action"`
	Detectors       []string        `json:"detectors"`
	Keywords        []string        `json:"keywords"`
	CustomPatterns  []CustomPattern `json:"custom_patterns"`
	BypassFileTypes []string        `json:"bypass_file_types"`
	DetectorWeights map[string]int  `json:"detector_weights"`
	BlockThreshold  *int            `json:"block_threshold,omitempty"`
	AlertThreshold  *int            `json:"alert_threshold,omitempty"`
	Priority        int             `json:"priority"`
	// Reason a part couldn't be inspected → "alert" | "block" | "allow".
	OnUnscannable map[string]string `json:"on_unscannable"`
}

// Match is one detector hit (already masked — never a raw sensitive value).
type Match struct {
	Detector      string `json:"detector"`
	Label         string `json:"label"`
	MaskedPreview string `json:"masked_preview"`
	Weight        int    `json:"weight"`
}

// Verdict is dlp-service's decision for a piece of content.
type Verdict struct {
	Scanned    bool           `json:"scanned"`
	Matched    bool           `json:"matched"`
	Score      int            `json:"score"`
	Band       string         `json:"band"`   // block | alert | allow
	Action     string         `json:"action"` // block | alert | log | allow
	PolicyName string         `json:"policy_name"`
	Reason     string         `json:"reason"`
	Detectors  []string       `json:"detectors"`
	Matches    []Match        `json:"matches"`
	Thresholds map[string]int `json:"thresholds"`
}

type scanRequest struct {
	OrgID       string           `json:"org_id"`
	Filename    string           `json:"filename"`
	ContentType string           `json:"content_type"`
	Destination string           `json:"destination"`
	ContentB64  string           `json:"content_b64"`
	Policies    []PolicyEnvelope `json:"policies"`
}

// otelhttp.NewTransport creates a child span per call and propagates the
// traceparent header, so this hop joins whatever trace admin-api's own
// incoming request started instead of being invisible in between.
var httpClient = &http.Client{Timeout: 15 * time.Second, Transport: otelhttp.NewTransport(http.DefaultTransport)}

func serviceURL() string {
	return strings.TrimRight(os.Getenv("DLP_SERVICE_URL"), "/")
}

func secret() string {
	s := os.Getenv("DLP_SERVICE_SECRET")
	if s == "" {
		s = "dev-insecure-dlp-secret-change-me"
	}
	return s
}

// Enabled reports whether a dlp-service endpoint is configured.
func Enabled() bool { return serviceURL() != "" }

// MintToken builds a short-TTL, org-bound HMAC token dlp-service verifies.
// Format: v1.<b64url(payload)>.<b64url(hmac_sha256(payload, secret))>.
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

// Scan submits one piece of content + policy config to dlp-service's
// pattern detectors and returns its verdict. ctx should carry the inbound
// request's span so this hop joins that trace.
func Scan(ctx context.Context, orgID, filename, contentType, destination string, content []byte, policies []PolicyEnvelope) (*Verdict, error) {
	reqBody, err := json.Marshal(scanRequest{
		OrgID:       orgID,
		Filename:    filename,
		ContentType: contentType,
		Destination: destination,
		ContentB64:  base64.StdEncoding.EncodeToString(content),
		Policies:    policies,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL()+"/v1/scan", bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+MintToken(orgID, 5*time.Minute))

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Include the body: a bare status code turned a contract mismatch into
		// an invisible, permanent fallback to the in-process scanner.
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("dlp-service returned %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}

	var v Verdict
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return nil, err
	}
	return &v, nil
}

// UploadMeta is one intercepted outbound request as the endpoint agent saw
// it — what dlp-service needs to decide whether a person sent it.
type UploadMeta struct {
	Host         string `json:"host"`
	Path         string `json:"path"`
	Method       string `json:"method"`
	ContentType  string `json:"content_type"`
	Filename     string `json:"filename"`
	UserAgent    string `json:"user_agent"`
	Source       string `json:"source"`
	SecFetchMode string `json:"sec_fetch_mode"`
	SecFetchDest string `json:"sec_fetch_dest"`
}

// Inspection is dlp-service's answer to "is this a user action, and what
// was it". When Relevant is false nothing was scanned.
type Inspection struct {
	Relevant   bool   `json:"relevant"`
	SkipReason string `json:"skip_reason"`
	// "file" or "text"; empty when not relevant.
	Kind      string `json:"kind"`
	Operation string `json:"operation"`
	// The attached file's real name, when there is one.
	Filename      string `json:"filename"`
	RequestSource string `json:"request_source"`
	AppName       string `json:"app_name"`
	Site          string `json:"site"`
	Destination   string `json:"destination"`
}

// UploadVerdict is the single verdict for everything the upload contained.
type UploadVerdict struct {
	Matched    bool     `json:"matched"`
	Score      int      `json:"score"`
	Band       string   `json:"band"`
	Action     string   `json:"action"`
	PolicyName string   `json:"policy_name"`
	Detectors  []string `json:"detectors"`
	// "Label: masked preview" per finding — never a raw sensitive value.
	Previews []string `json:"previews"`
	Reason   string   `json:"reason"`
}

// UploadOutcome is dlp-service's full answer. Verdict is nil when the
// request was not a user action.
type UploadOutcome struct {
	Inspection Inspection     `json:"inspection"`
	Verdict    *UploadVerdict `json:"verdict"`
}

// uploadClient allows for what a whole upload can take: extracting a large
// archive, OCR of scanned pages, and LLM calls — minutes, not the 15s a
// single text scan gets. The agent never waits on this (it fires the scan
// and relays the upload straight away), so the long ceiling costs nobody.
var uploadClient = &http.Client{Timeout: 5 * time.Minute, Transport: otelhttp.NewTransport(http.DefaultTransport)}

// ScanUpload runs dlp-service's whole pipeline on one intercepted upload.
// The body is streamed, never held in memory: multipart/form-data with the
// JSON request first (so the service checks the token before reading any
// of the body) and the raw body second.
func ScanUpload(ctx context.Context, orgID string, meta UploadMeta, policies []PolicyEnvelope, body io.Reader) (*UploadOutcome, error) {
	reqJSON, err := json.Marshal(struct {
		OrgID string `json:"org_id"`
		UploadMeta
		Policies []PolicyEnvelope `json:"policies"`
	}{orgID, meta, policies})
	if err != nil {
		return nil, err
	}

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		err := func() error {
			part, err := mw.CreateFormField("request")
			if err != nil {
				return err
			}
			if _, err := part.Write(reqJSON); err != nil {
				return err
			}
			part, err = mw.CreateFormFile("body", "body")
			if err != nil {
				return err
			}
			if _, err := io.Copy(part, body); err != nil {
				return err
			}
			return mw.Close()
		}()
		pw.CloseWithError(err)
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL()+"/v1/scan-upload", pr)
	if err != nil {
		pr.Close()
		return nil, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+MintToken(orgID, 5*time.Minute))

	resp, err := uploadClient.Do(req)
	if err != nil {
		pr.Close()
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("dlp-service scan-upload returned %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}
	var out UploadOutcome
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}
