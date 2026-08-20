// Package shadowitclient calls the standalone shadowit-service to classify
// domains as known cloud/SaaS apps. When SHADOWIT_SERVICE_URL is unset,
// Enabled() is false and the caller reports domains as unclassified.
package shadowitclient

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

type AppResult struct {
	Domain  string `json:"domain"`
	Matched bool   `json:"matched"`
	App     string `json:"app"`
	// DisplayName is always set — the catalog product name when known, else the
	// registrable domain. Use it for UI labels; use App/Matched for shadow-IT
	// logic that must distinguish a known app from an unknown one.
	DisplayName string `json:"display_name"`
	Category    string `json:"category"`
	RiskScore   int    `json:"risk_score"`
}

var httpClient = &http.Client{Timeout: 10 * time.Second}

func serviceURL() string { return strings.TrimRight(os.Getenv("SHADOWIT_SERVICE_URL"), "/") }

func secret() string {
	if s := os.Getenv("SHADOWIT_SERVICE_SECRET"); s != "" {
		return s
	}
	return "dev-insecure-shadowit-secret-change-me"
}

func Enabled() bool { return serviceURL() != "" }

func MintToken(orgID string, ttl time.Duration) string {
	payload, _ := json.Marshal(map[string]any{
		"iss": "admin-api", "org_id": orgID, "exp": time.Now().Add(ttl).Unix(),
	})
	mac := hmac.New(sha256.New, []byte(secret()))
	mac.Write(payload)
	enc := base64.RawURLEncoding
	return "v1." + enc.EncodeToString(payload) + "." + enc.EncodeToString(mac.Sum(nil))
}

// Classify returns the catalog match for each domain (order not guaranteed to
// match input; use the Domain field to key results).
func Classify(orgID string, domains []string) ([]AppResult, error) {
	body, _ := json.Marshal(map[string]any{"org_id": orgID, "domains": domains})
	req, err := http.NewRequest(http.MethodPost, serviceURL()+"/v1/classify", bytes.NewReader(body))
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
		return nil, fmt.Errorf("shadowit-service returned %d", resp.StatusCode)
	}
	var out struct {
		Results []AppResult `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Results, nil
}
