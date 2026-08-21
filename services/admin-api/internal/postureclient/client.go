// Package postureclient calls the standalone posture-service (device posture
// scoring + GeoIP resolution). No-ops gracefully when POSTURE_SERVICE_URL is
// unset (Enabled() == false) so heartbeats still work without it.
package postureclient

import (
	"bytes"
	"context"
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

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// Signals mirror posture-service's; pointers distinguish "off" from "unknown".
type Signals struct {
	DiskEncryption *bool  `json:"disk_encryption"`
	Firewall       *bool  `json:"firewall"`
	OSUpToDate     *bool  `json:"os_up_to_date"`
	ScreenLock     *bool  `json:"screen_lock"`
	Antivirus      *bool  `json:"antivirus"`
	OSType         string `json:"os_type"`
	OSVersion      string `json:"os_version"`
}

type PostureResult struct {
	Score   int      `json:"score"`
	Status  string   `json:"status"`
	Passed  []string `json:"passed"`
	Failed  []string `json:"failed"`
	Unknown []string `json:"unknown"`
	Reasons []string `json:"reasons"`
}

type GeoResult struct {
	IP          string `json:"ip"`
	IsPrivate   bool   `json:"is_private"`
	CountryCode string `json:"country_code"`
	Country     string `json:"country"`
}

var httpClient = &http.Client{Timeout: 8 * time.Second, Transport: otelhttp.NewTransport(http.DefaultTransport)}

func serviceURL() string { return strings.TrimRight(os.Getenv("POSTURE_SERVICE_URL"), "/") }

func secret() string {
	if s := os.Getenv("POSTURE_SERVICE_SECRET"); s != "" {
		return s
	}
	return "dev-insecure-posture-secret-change-me"
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

func Evaluate(ctx context.Context, orgID, deviceID string, s Signals) (*PostureResult, error) {
	body, _ := json.Marshal(map[string]any{"org_id": orgID, "device_id": deviceID, "signals": s})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL()+"/v1/posture", bytes.NewReader(body))
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
		return nil, fmt.Errorf("posture-service returned %d", resp.StatusCode)
	}
	var r PostureResult
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}

func GeoIP(ctx context.Context, orgID, ip string) (*GeoResult, error) {
	q := url.Values{}
	q.Set("org_id", orgID)
	q.Set("ip", ip)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serviceURL()+"/v1/geoip?"+q.Encode(), nil)
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
		return nil, fmt.Errorf("posture-service returned %d", resp.StatusCode)
	}
	var r GeoResult
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}
