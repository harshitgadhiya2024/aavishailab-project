package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aavishield/threatintel-service/internal/api"
	"github.com/aavishield/threatintel-service/internal/config"
	"github.com/aavishield/threatintel-service/internal/feeds"
	"github.com/aavishield/threatintel-service/internal/store"
)

func main() {
	cfg := config.Load()

	// `threatintel healthcheck` probes /healthz and exits 0/1. The runtime image
	// is distroless, so the container healthcheck has no wget/curl to call — the
	// binary probes itself instead.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(cfg.Port))
	}

	if cfg.RequireAuth && cfg.UsingDefaultSecret() {
		log.Println("⚠️  THREATINTEL_SERVICE_SECRET is the built-in default — set a strong shared secret in production.")
	}

	st := store.New()

	if cfg.EnableFeeds {
		fetcher := feeds.HTTPFetcher{}
		// Initial sync in the background so startup isn't blocked on network;
		// lookups fail-open (score 0) until the first sync lands.
		go func() {
			feeds.Sync(st, fetcher, feeds.DefaultSources)
			for range time.Tick(cfg.SyncInterval) {
				feeds.Sync(st, fetcher, feeds.DefaultSources)
			}
		}()
	} else {
		log.Println("threatintel: feed sync disabled (THREATINTEL_ENABLE_FEEDS=false)")
	}

	srv := api.New(cfg, st)
	log.Printf("🛡️  threatintel-service listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, srv.Handler()); err != nil {
		log.Fatalf("threatintel-service failed: %v", err)
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
