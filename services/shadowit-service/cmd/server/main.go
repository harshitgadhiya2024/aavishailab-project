package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aavishield/shadowit-service/internal/api"
	"github.com/aavishield/shadowit-service/internal/catalog"
	"github.com/aavishield/shadowit-service/internal/config"
	"github.com/aavishield/shadowit-service/internal/tracing"
)

func main() {
	cfg := config.Load()

	// `shadowit healthcheck` probes /healthz and exits 0/1. The runtime image is
	// distroless, so the container healthcheck has no wget/curl to call — the
	// binary probes itself instead.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(cfg.Port))
	}

	shutdownTracing := tracing.Init("shadowit-service")
	defer shutdownTracing(context.Background())

	if cfg.RequireAuth && cfg.UsingDefaultSecret() {
		log.Println("⚠️  SHADOWIT_SERVICE_SECRET is the built-in default — set a strong shared secret in production.")
	}

	cat := catalog.New()
	if err := cat.LoadOverride(cfg.CatalogFile); err != nil {
		log.Printf("shadowit: catalog override load failed: %v", err)
	}
	log.Printf("shadowit: catalog has %d apps", cat.Size())

	srv := api.New(cfg, cat)
	log.Printf("🛡️  shadowit-service listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, srv.Handler()); err != nil {
		log.Fatalf("shadowit-service failed: %v", err)
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
