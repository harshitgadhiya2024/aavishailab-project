// Package aiclient calls ai-service's internal DLP vision-classification
// endpoint (POST /v1/dlp/classify-image) — identifies whether an image
// extract-service pulled out of an upload is a photo/screenshot of a
// sensitive document (Aadhaar/PAN/passport/credit card/credentials/etc.).
// Same HMAC bearer-token convention as dlpclient/extractclient: admin-api
// mints a short-TTL, org-bound token; ai-service verifies it the same way.
//
// If AI_SERVICE_URL is unset, Enabled() is false and the caller skips
// vision classification entirely — OCR-text-based detection (which doesn't
// depend on this at all) keeps working regardless.
package aiclient

import (
	"bytes"
	"context"
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

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// VisionVerdict mirrors ai-service's VisionVerdict.to_dict() response shape.
type VisionVerdict struct {
	Sensitive       bool   `json:"sensitive"`
	DocType         string `json:"doc_type"`
	Confidence      int    `json:"confidence"`
	Evidence        string `json:"evidence"`
	Cached          bool   `json:"cached"`
	BudgetExhausted bool   `json:"budget_exhausted"`
}

var httpClient = &http.Client{Timeout: 30 * time.Second, Transport: otelhttp.NewTransport(http.DefaultTransport)}

func serviceURL() string {
	return strings.TrimRight(os.Getenv("AI_SERVICE_URL"), "/")
}

func secret() string {
	s := os.Getenv("AI_SERVICE_INTERNAL_SECRET")
	if s == "" {
		s = "dev-insecure-ai-internal-secret-change-me"
	}
	return s
}

// Enabled reports whether an ai-service endpoint is configured.
func Enabled() bool { return serviceURL() != "" }

// MintToken mirrors dlpclient/extractclient's minting — the identical
// v1.<payload>.<sig> shape every internal microservice verifies the same way.
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

type classifyRequest struct {
	OrgID    string `json:"org_id"`
	ImageB64 string `json:"image_b64"`
	Mime     string `json:"mime"`
}

// ClassifyImage submits a (small, already-downscaled — extract-service caps
// this before it ever reaches here) base64 image for vision classification.
func ClassifyImage(ctx context.Context, orgID, imageB64, mime string) (*VisionVerdict, error) {
	reqBody, err := json.Marshal(classifyRequest{OrgID: orgID, ImageB64: imageB64, Mime: mime})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL()+"/v1/dlp/classify-image", bytes.NewReader(reqBody))
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
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("ai-service classify-image returned %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}

	var v VisionVerdict
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return nil, err
	}
	return &v, nil
}
