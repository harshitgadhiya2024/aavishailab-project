package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aavishield/posture-service/internal/api"
	"github.com/aavishield/posture-service/internal/config"
	"github.com/aavishield/posture-service/internal/geoip"
	"github.com/aavishield/posture-service/internal/tracing"
)

func main() {
	cfg := config.Load()

	// `posture healthcheck` probes /healthz and exits 0/1. The runtime image is
	// distroless, so the container healthcheck has no wget/curl to call — the
	// binary probes itself instead.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(cfg.Port))
	}

	shutdownTracing := tracing.Init("posture-service")
	defer shutdownTracing(context.Background())

	if cfg.RequireAuth && cfg.UsingDefaultSecret() {
		log.Println("⚠️  POSTURE_SERVICE_SECRET is the built-in default — set a strong shared secret in production.")
	}

	geo := geoip.New(cfg.GeoIPCSV)
	if cfg.GeoIPCSV == "" {
		log.Println("posture: POSTURE_GEOIP_CSV unset — public IPs resolve to 'unknown' (private/reserved still detected).")
	} else {
		log.Printf("posture: loaded %d GeoIP country ranges", geo.Count())
	}

	srv := api.New(cfg, geo)
	log.Printf("🛡️  posture-service listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, srv.Handler()); err != nil {
		log.Fatalf("posture-service failed: %v", err)
	}
}

func healthcheck(port string) int {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
