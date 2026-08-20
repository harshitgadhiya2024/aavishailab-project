// seed populates Postgres with N synthetic devices + agent tokens so the
// load-test runner (cmd/run) can authenticate as real agents against
// admin-api's /internal/agent/* endpoints — the actual hot path identified
// in the Rust migration plan's Phase 0 baseline.
//
// All rows are tagged with a "loadtest-" prefixed org slug / hostname so
// they're easy to find and delete afterward; nothing here touches real
// tenant data (the DB had zero real tenants at the time this was written).
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type tokenRecord struct {
	DeviceID string `json:"device_id"`
	AgentKey string `json:"agent_key"`
}

func main() {
	n := flag.Int("n", 1000, "number of simulated devices")
	dsn := flag.String("dsn", os.Getenv("DATABASE_URL"), "postgres DSN")
	out := flag.String("out", "tokens.json", "output file for device_id:agent_key pairs")
	slug := flag.String("slug", "loadtest-org", "org slug to seed under (reused if it exists)")
	flag.Parse()

	if *dsn == "" {
		log.Fatal("set -dsn or DATABASE_URL")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	var orgID string
	err = pool.QueryRow(ctx, `SELECT id FROM organizations WHERE slug = $1`, *slug).Scan(&orgID)
	if err != nil {
		orgID = uuid.New().String()
		_, err = pool.Exec(ctx, `
			INSERT INTO organizations (id, name, slug, created_at, updated_at)
			VALUES ($1, 'Load Test Org', $2, now(), now())`, orgID, *slug)
		if err != nil {
			log.Fatalf("insert org: %v", err)
		}
		fmt.Printf("created org %s (%s)\n", *slug, orgID)
	} else {
		fmt.Printf("reusing org %s (%s)\n", *slug, orgID)
	}

	records := make([]tokenRecord, 0, *n)

	batch := &pgxBatchWriter{ctx: ctx, pool: pool}
	for i := 0; i < *n; i++ {
		empID := uuid.New().String()
		devID := uuid.New().String()
		agentKey := uuid.New().String()
		sum := sha256.Sum256([]byte(agentKey))
		tokenHash := hex.EncodeToString(sum[:])

		batch.queue(`INSERT INTO employees (id, org_id, first_name, last_name, email, status, created_at, updated_at)
			VALUES ($1, $2, 'Load', 'Test', $3, 'active', now(), now())`,
			empID, orgID, fmt.Sprintf("loadtest-%d@example.test", i))

		batch.queue(`INSERT INTO devices (id, org_id, employee_id, hostname, os_type, status, enrolled_at, created_at, updated_at)
			VALUES ($1, $2, $3, $4, 'linux', 'online', now(), now(), now())`,
			devID, orgID, empID, fmt.Sprintf("loadtest-host-%d", i))

		batch.queue(`INSERT INTO agent_tokens (id, device_id, org_id, employee_id, token_hash, revoked, created_at)
			VALUES ($1, $2, $3, $4, $5, false, now())`,
			uuid.New().String(), devID, orgID, empID, tokenHash)

		records = append(records, tokenRecord{DeviceID: devID, AgentKey: agentKey})

		if (i+1)%500 == 0 {
			if err := batch.flush(); err != nil {
				log.Fatalf("flush at %d: %v", i, err)
			}
			fmt.Printf("seeded %d/%d\n", i+1, *n)
		}
	}
	if err := batch.flush(); err != nil {
		log.Fatalf("final flush: %v", err)
	}

	f, err := os.Create(*out)
	if err != nil {
		log.Fatalf("create %s: %v", *out, err)
	}
	defer f.Close()
	if err := json.NewEncoder(f).Encode(records); err != nil {
		log.Fatalf("write %s: %v", *out, err)
	}
	fmt.Printf("done: %d devices seeded under org %s, tokens written to %s\n", *n, orgID, *out)
}
