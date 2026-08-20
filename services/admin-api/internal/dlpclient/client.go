// Package dlpclient calls the standalone dlp-service (content scanning +
// weighted sensitivity scoring). admin-api stays the control plane and event
// store; dlp-service is stateless compute. If DLP_SERVICE_URL is unset the
// caller falls back to the in-process dlp package, so the platform still
// enforces DLP even when the microservice isn't deployed.
package dlpclient

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// CustomPattern mirrors an org-defined named regex.
type CustomPattern struct {
	Name  string `json:"name"`
	Regex string `json:"regex"`
}

// PolicyEnvelope is one DLP policy flattened into what dlp-service needs. It
// intentionally carries no DB types — just the scanning config.
type PolicyEnvelope struct {
	Name            string         `json:"name"`
	Action          string         `json:"action"`
	Detectors       []string       `json:"detectors"`
	Keywords        []string       `json:"keywords"`
	CustomPatterns  []CustomPattern `json:"custom_patterns"`
	BypassFileTypes []string       `json:"bypass_file_types"`
	DetectorWeights map[string]int `json:"detector_weights"`
	BlockThreshold  *int           `json:"block_threshold,omitempty"`
	AlertThreshold  *int           `json:"alert_threshold,omitempty"`
	Priority        int            `json:"priority"`
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

var httpClient = &http.Client{Timeout: 15 * time.Second}

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

// Scan submits content + policy config to dlp-service and returns its verdict.
func Scan(orgID, filename, contentType, destination string, content []byte, policies []PolicyEnvelope) (*Verdict, error) {
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

	req, err := http.NewRequest(http.MethodPost, serviceURL()+"/v1/scan", bytes.NewReader(reqBody))
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
