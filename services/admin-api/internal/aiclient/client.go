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

// TextVerdict mirrors ai-service's TextVerdict.to_dict() response shape.
type TextVerdict struct {
	Sensitive       bool     `json:"sensitive"`
	Categories      []string `json:"categories"`
	Confidence      int      `json:"confidence"`
	Evidence        string   `json:"evidence"`
	Cached          bool     `json:"cached"`
	BudgetExhausted bool     `json:"budget_exhausted"`
}

type classifyTextRequest struct {
	OrgID string `json:"org_id"`
	Text  string `json:"text"`
}

// ClassifyText submits a chunk of extracted text for semantic
// sensitivity classification (salary sheets, contracts, customer PII
// lists, financials — the class of leak that has no regex). admin-api
// only calls this when checksum/regex detection did not already block and
// a policy enabled the "ai_text" detector.
func ClassifyText(ctx context.Context, orgID, text string) (*TextVerdict, error) {
	reqBody, err := json.Marshal(classifyTextRequest{OrgID: orgID, Text: text})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL()+"/v1/dlp/classify-text", bytes.NewReader(reqBody))
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
		return nil, fmt.Errorf("ai-service classify-text returned %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}

	var v TextVerdict
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return nil, err
	}
	return &v, nil
}

// TranscriptResult mirrors ai-service's /v1/dlp/transcribe response.
type TranscriptResult struct {
	OK              bool   `json:"ok"`
	Text            string `json:"text"`
	Cached          bool   `json:"cached"`
	BudgetExhausted bool   `json:"budget_exhausted"`
}

type transcribeRequest struct {
	OrgID    string `json:"org_id"`
	AudioB64 string `json:"audio_b64"`
	Mime     string `json:"mime"`
}

// Transcribe submits base64 audio (an audio file, or audio demuxed from a
// video) for best-effort speech-to-text. Fails soft: OK=false / empty text
// on any problem, and the caller records the part as unscannable.
func Transcribe(ctx context.Context, orgID, audioB64, mime string) (*TranscriptResult, error) {
	reqBody, err := json.Marshal(transcribeRequest{OrgID: orgID, AudioB64: audioB64, Mime: mime})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL()+"/v1/dlp/transcribe", bytes.NewReader(reqBody))
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
		return nil, fmt.Errorf("ai-service transcribe returned %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}

	var r TranscriptResult
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}
