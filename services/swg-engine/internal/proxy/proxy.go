package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"strings"
	"time"

	"github.com/aavishield/swg-engine/internal/policy"
)

const blockPageHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aavishield — Access Blocked</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #f0f4fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 48px; max-width: 480px; width: 90%%; box-shadow: 0 4px 24px rgba(0,72,160,0.12); text-align: center; }
    .shield { font-size: 64px; margin-bottom: 24px; }
    h1 { color: #0048A0; font-size: 24px; margin-bottom: 12px; }
    p { color: #555; line-height: 1.6; margin-bottom: 8px; }
    .domain { font-weight: 600; color: #0048A0; }
    .policy { background: #f0f4fa; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 14px; color: #333; }
    .footer { margin-top: 24px; font-size: 12px; color: #999; }
    a { color: #0048A0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="shield">🛡️</div>
    <h1>Access Blocked</h1>
    <p>This website has been blocked by your organization's security policy.</p>
    <div class="policy">
      <strong>Domain:</strong> <span class="domain">%%DOMAIN%%</span><br>
      <strong>Reason:</strong> %%REASON%%<br>
      <strong>Category:</strong> %%CATEGORY%%
    </div>
    <p>If you believe this is a mistake, please contact your IT administrator.</p>
    <div class="footer">Protected by <strong>Aavishield</strong> Zero Trust Security</div>
  </div>
</body>
</html>`

type HTTPProxy struct {
	cache       *policy.PolicyCache
	adminAPIURL string
	client      *http.Client
}

func NewHTTPProxy(cache *policy.PolicyCache, adminAPIURL string) *HTTPProxy {
	return &HTTPProxy{
		cache:       cache,
		adminAPIURL: adminAPIURL,
		client:      &http.Client{Timeout: 30 * time.Second},
	}
}

func (p *HTTPProxy) Start(port string) error {
	server := &http.Server{
		Addr:    ":" + port,
		Handler: p,
	}
	return server.ListenAndServe()
}

func (p *HTTPProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		p.handleTunnel(w, r)
		return
	}

	// Extract domain
	host := r.Host
	if host == "" {
		host = r.URL.Host
	}
	domain, _, _ := net.SplitHostPort(host)
	if domain == "" {
		domain = host
	}

	// Get org context from custom header (set by agent)
	orgID := r.Header.Get("X-Aavishield-OrgID")

	// Check policy
	rule := p.cache.CheckDomain(domain, orgID)
	if rule != nil && rule.Action == "block" {
		p.serveBlockPage(w, domain, rule.Reason, rule.Category)
		p.reportEvent(orgID, r, domain, rule.Category, "blocked", rule.ID, rule.Reason)
		return
	}

	// Log allowed request
	if orgID != "" {
		p.reportEvent(orgID, r, domain, "", "allowed", "", "")
	}

	// Forward request
	proxy := httputil.NewSingleHostReverseProxy(r.URL)
	proxy.ServeHTTP(w, r)
}

func (p *HTTPProxy) handleTunnel(w http.ResponseWriter, r *http.Request) {
	host := r.Host
	domain, _, _ := net.SplitHostPort(host)
	if domain == "" {
		domain = host
	}

	orgID := r.Header.Get("X-Aavishield-OrgID")
	rule := p.cache.CheckDomain(domain, orgID)
	if rule != nil && rule.Action == "block" {
		http.Error(w, "Blocked by Aavishield policy", http.StatusForbidden)
		p.reportEvent(orgID, r, domain, rule.Category, "blocked", rule.ID, rule.Reason)
		return
	}

	// Establish tunnel
	dest, err := net.DialTimeout("tcp", r.Host, 10*time.Second)
	if err != nil {
		http.Error(w, "Failed to connect", http.StatusBadGateway)
		return
	}

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "Hijacking not supported", http.StatusInternalServerError)
		return
	}

	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		return
	}

	_, _ = clientConn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))

	go transfer(dest, clientConn)
	go transfer(clientConn, dest)
}

func transfer(dst io.WriteCloser, src io.Reader) {
	defer dst.Close()
	_, _ = io.Copy(dst, src)
}

func (p *HTTPProxy) serveBlockPage(w http.ResponseWriter, domain, reason, category string) {
	if reason == "" {
		reason = "Organization security policy"
	}
	if category == "" {
		category = "Blocked"
	}

	html := strings.ReplaceAll(blockPageHTML, "%%DOMAIN%%", domain)
	html = strings.ReplaceAll(html, "%%REASON%%", reason)
	html = strings.ReplaceAll(html, "%%CATEGORY%%", category)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusForbidden)
	fmt.Fprint(w, html)
}

func (p *HTTPProxy) reportEvent(orgID string, r *http.Request, domain, category, action, ruleID, reason string) {
	if orgID == "" {
		return
	}

	event := map[string]any{
		"org_id":        orgID,
		"event_type":    "web_request",
		"action":        action,
		"target":        r.URL.String(),
		"target_domain": domain,
		"category":      category,
		"policy_name":   reason,
		"timestamp":     time.Now().UTC().Format(time.RFC3339),
	}
	if empID := r.Header.Get("X-Aavishield-EmployeeID"); empID != "" {
		event["employee_id"] = empID
	}
	if devID := r.Header.Get("X-Aavishield-DeviceID"); devID != "" {
		event["device_id"] = devID
	}

	body, _ := json.Marshal(event)
	req, _ := http.NewRequest("POST", p.adminAPIURL+"/internal/activity", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		log.Printf("Failed to report event: %v", err)
		return
	}
	defer resp.Body.Close()
}
