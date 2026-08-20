// Package api exposes the shadow-IT classification endpoints (stdlib net/http).
package api

import (
	"encoding/json"
	"net/http"
	"sync/atomic"

	"github.com/aavishield/shadowit-service/internal/auth"
	"github.com/aavishield/shadowit-service/internal/catalog"
	"github.com/aavishield/shadowit-service/internal/config"
)

type Server struct {
	cfg     config.Config
	catalog *catalog.Catalog
	calls   uint64
	authErr uint64
}

func New(cfg config.Config, cat *catalog.Catalog) *Server {
	return &Server{cfg: cfg, catalog: cat}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/metrics", s.metrics)
	mux.HandleFunc("/v1/classify", s.classify)
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "service": "shadowit-service", "catalog_size": s.catalog.Size(),
	})
}

func (s *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(
		"shadowit_classify_total " + itoa(int(atomic.LoadUint64(&s.calls))) + "\n" +
			"shadowit_auth_failures_total " + itoa(int(atomic.LoadUint64(&s.authErr))) + "\n" +
			"shadowit_catalog_size " + itoa(s.catalog.Size()) + "\n",
	))
}

type classifyReq struct {
	OrgID   string   `json:"org_id"`
	Domains []string `json:"domains"`
}

func (s *Server) classify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
		return
	}
	var req classifyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OrgID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "org_id required"})
		return
	}
	if s.cfg.RequireAuth {
		if err := auth.Verify(r.Header.Get("Authorization"), req.OrgID, s.cfg.ServiceSecret); err != nil {
			atomic.AddUint64(&s.authErr, 1)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
	}
	atomic.AddUint64(&s.calls, 1)

	results := make([]catalog.Result, 0, len(req.Domains))
	for _, d := range req.Domains {
		results = append(results, s.catalog.Classify(d))
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
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
