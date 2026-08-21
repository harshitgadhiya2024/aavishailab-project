// Package casbclient calls the standalone casb-service (inline app-control +
// out-of-band cloud share analysis). Enabled() is false when CASB_SERVICE_URL
// is unset.
package casbclient

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

// otelhttp.NewTransport creates a child span per call and propagates the
// traceparent header, so this hop joins whatever trace admin-api's own
// incoming request started instead of being invisible in between.
var httpClient = &http.Client{Timeout: 15 * time.Second, Transport: otelhttp.NewTransport(http.DefaultTransport)}

func serviceURL() string { return strings.TrimRight(os.Getenv("CASB_SERVICE_URL"), "/") }

func secret() string {
	if s := os.Getenv("CASB_SERVICE_SECRET"); s != "" {
		return s
	}
	return "dev-insecure-casb-secret-change-me"
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

// Post forwards a JSON payload to a casb-service path and returns the decoded
// response. Returns the upstream status code so the handler can surface a
// 400 (e.g. an OAuth-required provider) distinctly from a 502.
// ctx should carry the inbound request's span so this hop joins that trace.
func Post(ctx context.Context, orgID, path string, payload map[string]any) (int, map[string]any, error) {
	// casb-service requires org_id in the body as well as in the bearer token.
	// Setting it here rather than at each call site: a caller that forgot it
	// got a 422 that the agent quietly read as "allow", so inline app-control
	// silently did nothing.
	if payload == nil {
		payload = map[string]any{}
	}
	payload["org_id"] = orgID

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL()+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+MintToken(orgID, 5*time.Minute))

	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			return resp.StatusCode, nil, fmt.Errorf("bad casb-service response: %w", err)
		}
	}
	return resp.StatusCode, out, nil
}
