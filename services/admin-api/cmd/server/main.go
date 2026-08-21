package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"time"

	"github.com/aavishield/admin-api/internal/database"
	"github.com/aavishield/admin-api/internal/handlers"
	"github.com/aavishield/admin-api/internal/mailer"
	"github.com/aavishield/admin-api/internal/notifier"
	"github.com/aavishield/admin-api/internal/retention"
	"github.com/aavishield/admin-api/internal/riskengine"
	"github.com/aavishield/admin-api/internal/router"
	"github.com/aavishield/admin-api/internal/tracing"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

func main() {
	// Load .env in development
	if os.Getenv("APP_ENV") != "production" {
		_ = godotenv.Load("../../.env")
		_ = godotenv.Load(".env")
	}

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "seed":
			runSeed()
			return
		}
	}

	shutdownTracing := tracing.Init("admin-api")
	defer shutdownTracing(context.Background())

	db, rdb, err := connectStores()
	if err != nil {
		log.Fatal(err)
	}

	// Risk engine: sync free/open threat-intel feeds every 6h, and assess
	// newly-seen domains every 15s so a malicious site gets auto-blocked
	// shortly after its first sighting (see riskengine/worker.go for why the
	// very first visit itself can't be pre-emptively blocked this way).
	riskengine.StartFeedSyncLoop(db, 6*time.Hour)
	riskengine.NewAssessmentWorker(db, 15*time.Second, 24*time.Hour).Start()

	// Devices miss 3 heartbeats (60s each) in a row before being swept
	// offline — abrupt agent death (crash, force-quit) never calls
	// ReportOffline directly, so this is what actually catches it.
	handlers.StartDeviceOfflineSweep(db, 30*time.Second, 180*time.Second)

	// Enforce screenshot retention (settings promise "keep for N days").
	handlers.StartScreenshotRetentionSweep(db, 6*time.Hour)

	// Enforce the platform's data_retention setting for activity events and
	// audit log rows — without this the setting would just be a UI that
	// doesn't do anything.
	retention.StartDataRetentionSweep(db, 24*time.Hour)

	// ClamAV may still be downloading its virus DB on first boot — don't
	// block startup on it, just retry a few times and log clearly either way
	// so it's obvious from the logs whether file-download scanning is live.
	go func() {
		for i := 0; i < 10; i++ {
			if err := riskengine.Ping(); err == nil {
				log.Println("🛡️  ClamAV reachable — file download scanning active")
				return
			}
			time.Sleep(15 * time.Second)
		}
		log.Println("⚠️  ClamAV unreachable after startup retries — file downloads will be relayed unscanned (fail-open)")
	}()

	// Build and run router
	// Email: transactional messages are queued by handlers; the notifier owns
	// the scheduled ones (incident digests, inactivity notices, weekly summary).
	mailer.Init()
	notifier.New(db).Start(1 * time.Hour)

	r := router.Setup(db, rdb)

	port := os.Getenv("ADMIN_API_PORT")
	if port == "" {
		port = "6000"
	}

	log.Printf("🚀 Aavishield Admin API running on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func connectStores() (*gorm.DB, *redis.Client, error) {
	db, err := database.ConnectPostgres()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to connect to PostgreSQL: %w", err)
	}

	rdb, err := database.ConnectRedis()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	if err := database.AutoMigrate(db); err != nil {
		return nil, nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	if err := database.DedupeDevices(db); err != nil {
		return nil, nil, fmt.Errorf("failed to dedupe devices: %w", err)
	}

	if err := database.MigrateUserRoles(db); err != nil {
		return nil, nil, fmt.Errorf("failed to migrate user roles: %w", err)
	}

	if err := database.MigrateCategoryDomainIndexes(db); err != nil {
		return nil, nil, fmt.Errorf("failed to migrate category domain indexes: %w", err)
	}

	// Category domain lists are real product config (needed for category-based
	// policy blocking), not dev-only fixture data — unlike SeedDevData below,
	// this runs in every environment, including production.
	if err := database.MigrateAppControlIndexes(db); err != nil {
		return nil, nil, fmt.Errorf("failed to migrate application control indexes: %w", err)
	}

	if err := database.SeedDomainCategories(db); err != nil {
		return nil, nil, fmt.Errorf("failed to seed domain categories: %w", err)
	}

	// Same reasoning for the application catalog: application control can only
	// act on software the catalog describes.
	if err := database.SeedApplications(db); err != nil {
		return nil, nil, fmt.Errorf("failed to seed applications: %w", err)
	}

	if os.Getenv("APP_ENV") != "production" {
		if err := database.SeedDevData(db); err != nil {
			return nil, nil, fmt.Errorf("failed to seed development data: %w", err)
		}
	}

	return db, rdb, nil
}

func runSeed() {
	db, _, err := connectStores()
	if err != nil {
		log.Fatal(err)
	}
	_ = db
	log.Println("Seed complete")
}
