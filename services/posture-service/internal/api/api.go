// Package api exposes the posture + geoip HTTP endpoints (stdlib net/http).
package api

import (
	"encoding/json"
	"net/http"
	"sync/atomic"

	"github.com/aavishield/posture-service/internal/auth"
	"github.com/aavishield/posture-service/internal/config"
	"github.com/aavishield/posture-service/internal/geoip"
	"github.com/aavishield/posture-service/internal/posture"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

type Server struct {
	cfg      config.Config
	geo      *geoip.Resolver
	postures uint64
	geos     uint64
	authFail uint64
}

func New(cfg config.Config, geo *geoip.Resolver) *Server {
	return &Server{cfg: cfg, geo: geo}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/metrics", s.metrics)
	mux.HandleFunc("/v1/posture", s.posture)
	mux.HandleFunc("/v1/geoip", s.geoip)
	// otelhttp.NewHandler extracts the incoming traceparent header (set by
	// admin-api's outbound client) and starts a child span, so this hop
	// joins the caller's trace instead of starting a disconnected one.
	return otelhttp.NewHandler(mux, "posture-service")
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) authorize(r *http.Request, orgID string) bool {
	if !s.cfg.RequireAuth {
		return true
	}
	if err := auth.Verify(r.Header.Get("Authorization"), orgID, s.cfg.ServiceSecret, s.cfg.ServiceSecretPrevious); err != nil {
		atomic.AddUint64(&s.authFail, 1)
		return false
	}
	return true
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "service": "posture-service", "geoip_ranges": s.geo.Count(),
	})
}

func (s *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(
		"posture_evaluations_total " + itoa(int(atomic.LoadUint64(&s.postures))) + "\n" +
			"posture_geoip_total " + itoa(int(atomic.LoadUint64(&s.geos))) + "\n" +
			"posture_auth_failures_total " + itoa(int(atomic.LoadUint64(&s.authFail))) + "\n",
	))
}

type postureReq struct {
	OrgID    string          `json:"org_id"`
	DeviceID string          `json:"device_id"`
	Signals  posture.Signals `json:"signals"`
}

func (s *Server) posture(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
		return
	}
	var req postureReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OrgID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "org_id required"})
		return
	}
	if !s.authorize(r, req.OrgID) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	atomic.AddUint64(&s.postures, 1)
	writeJSON(w, http.StatusOK, posture.Evaluate(req.Signals, s.cfg.PassThreshold, s.cfg.WarnThreshold))
}

func (s *Server) geoip(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	orgID, ip := q.Get("org_id"), q.Get("ip")
	if orgID == "" || ip == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "org_id and ip required"})
		return
	}
	if !s.authorize(r, orgID) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	atomic.AddUint64(&s.geos, 1)
	writeJSON(w, http.StatusOK, s.geo.Lookup(ip))
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
