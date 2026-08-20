// Package threatintelclient calls the standalone threatintel-service (domain /
// IP / file-hash reputation + risk scoring). If THREATINTEL_SERVICE_URL is
// unset the caller falls back to the in-process riskengine for domains.
package threatintelclient

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type Result struct {
	Indicator      string   `json:"indicator"`
	Kind           string   `json:"kind"`
	Score          int      `json:"score"`
	Band           string   `json:"band"`
	Category       string   `json:"category"`
	Source         string   `json:"source,omitempty"`
	ThreatIntelHit bool     `json:"threat_intel_hit"`
	Reasons        []string `json:"reasons"`
}

var httpClient = &http.Client{Timeout: 10 * time.Second}

func serviceURL() string { return strings.TrimRight(os.Getenv("THREATINTEL_SERVICE_URL"), "/") }

func secret() string {
	if s := os.Getenv("THREATINTEL_SERVICE_SECRET"); s != "" {
		return s
	}
	return "dev-insecure-threatintel-secret-change-me"
}

func Enabled() bool { return serviceURL() != "" }

func MintToken(orgID string, ttl time.Duration) string {
	payload, _ := json.Marshal(map[string]any{
		"iss":    "admin-api",
		"org_id": orgID,
		"exp":    time.Now().Add(ttl).Unix(),
	})
	mac := hmac.New(sha256.New, []byte(secret()))
	mac.Write(payload)
	enc := base64.RawURLEncoding
	return "v1." + enc.EncodeToString(payload) + "." + enc.EncodeToString(mac.Sum(nil))
}

// Lookup scores an indicator (kind: domain | ip | hash) for an org.
func Lookup(orgID, kind, indicator string) (*Result, error) {
	q := url.Values{}
	q.Set("org_id", orgID)
	q.Set(kind, indicator)
	req, err := http.NewRequest(http.MethodGet, serviceURL()+"/v1/lookup?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+MintToken(orgID, 5*time.Minute))

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("threatintel-service returned %d", resp.StatusCode)
	}
	var r Result
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}
