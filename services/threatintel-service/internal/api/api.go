// Package api exposes the threat-intel HTTP endpoints (stdlib net/http, no
// framework dependency).
package api

import (
	"encoding/json"
	"net/http"
	"sync/atomic"

	"github.com/aavishield/threatintel-service/internal/auth"
	"github.com/aavishield/threatintel-service/internal/config"
	"github.com/aavishield/threatintel-service/internal/scoring"
	"github.com/aavishield/threatintel-service/internal/store"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

type Server struct {
	cfg   config.Config
	store *store.Store
	scans uint64
	auth  uint64
}

func New(cfg config.Config, s *store.Store) *Server {
	return &Server{cfg: cfg, store: s}
}

func (srv *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", srv.health)
	mux.HandleFunc("/metrics", srv.metrics)
	mux.HandleFunc("/v1/score", srv.score)   // POST {org_id, indicator, kind}
	mux.HandleFunc("/v1/lookup", srv.lookup) // GET ?org_id=&domain=|ip=|hash=
	// otelhttp.NewHandler extracts the incoming traceparent header (set by
	// admin-api's outbound client) and starts a child span, so this hop
	// joins the caller's trace instead of starting a disconnected one.
	return otelhttp.NewHandler(mux, "threatintel-service")
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (srv *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "service": "threatintel-service", "indicators": srv.store.Counts(),
	})
}

func (srv *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	c := srv.store.Counts()
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(
		"threatintel_scans_total " + itoa(int(atomic.LoadUint64(&srv.scans))) + "\n" +
			"threatintel_auth_failures_total " + itoa(int(atomic.LoadUint64(&srv.auth))) + "\n" +
			"threatintel_domains " + itoa(c.Domains) + "\n" +
			"threatintel_ips " + itoa(c.IPs) + "\n" +
			"threatintel_hashes " + itoa(c.Hashes) + "\n",
	))
}

// authorize verifies the org-bound token (unless auth is disabled).
func (srv *Server) authorize(r *http.Request, orgID string) bool {
	if !srv.cfg.RequireAuth {
		return true
	}
	if err := auth.Verify(r.Header.Get("Authorization"), orgID, srv.cfg.ServiceSecret, srv.cfg.ServiceSecretPrevious); err != nil {
		atomic.AddUint64(&srv.auth, 1)
		return false
	}
	return true
}

type scoreReq struct {
	OrgID     string `json:"org_id"`
	Indicator string `json:"indicator"`
	Kind      string `json:"kind"` // domain | ip | hash (default domain)
}

func (srv *Server) score(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
		return
	}
	var req scoreReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OrgID == "" || req.Indicator == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "org_id and indicator required"})
		return
	}
	if !srv.authorize(r, req.OrgID) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	atomic.AddUint64(&srv.scans, 1)
	writeJSON(w, http.StatusOK, srv.scoreIndicator(req.Kind, req.Indicator))
}

// lookup is a GET convenience the dashboard uses — same scoring, query params.
func (srv *Server) lookup(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	orgID := q.Get("org_id")
	if orgID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "org_id required"})
		return
	}
	if !srv.authorize(r, orgID) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var kind, indicator string
	switch {
	case q.Get("domain") != "":
		kind, indicator = "domain", q.Get("domain")
	case q.Get("ip") != "":
		kind, indicator = "ip", q.Get("ip")
	case q.Get("hash") != "":
		kind, indicator = "hash", q.Get("hash")
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "one of domain/ip/hash required"})
		return
	}
	atomic.AddUint64(&srv.scans, 1)
	writeJSON(w, http.StatusOK, srv.scoreIndicator(kind, indicator))
}

func (srv *Server) scoreIndicator(kind, indicator string) scoring.Result {
	b, a := srv.cfg.BlockThreshold, srv.cfg.AlertThreshold
	switch kind {
	case "ip":
		return scoring.ScoreIP(srv.store, indicator, b, a)
	case "hash":
		return scoring.ScoreHash(srv.store, indicator, b, a)
	default:
		return scoring.ScoreDomain(srv.store, indicator, b, a)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
