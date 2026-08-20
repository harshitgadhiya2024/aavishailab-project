// run drives simulated devices against admin-api's /internal/agent/*
// endpoints at the real shipped-agent poll cadence (rules every 10s,
// activity every 5s, heartbeat every 60s — see scripts/agent/aavishield-agent.py),
// and reports p50/p95/p99 latency per endpoint. This is the Phase 0
// baseline the Rust migration plan's later phases are measured against.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type tokenRecord struct {
	DeviceID string `json:"device_id"`
	AgentKey string `json:"agent_key"`
}

type sample struct {
	endpoint string
	ms       float64
	status   int
}

func main() {
	tokensFile := flag.String("tokens", "tokens.json", "tokens.json from cmd/seed")
	baseURL := flag.String("base-url", "http://127.0.0.1:7100", "admin-api base URL")
	duration := flag.Duration("duration", 90*time.Second, "how long to run")
	rulesInterval := flag.Duration("rules-interval", 10*time.Second, "GetRules poll interval")
	activityInterval := flag.Duration("activity-interval", 5*time.Second, "activity flush interval")
	heartbeatInterval := flag.Duration("heartbeat-interval", 60*time.Second, "heartbeat interval")
	label := flag.String("label", "baseline", "label printed with results, e.g. 'baseline' or 'phase1'")
	flag.Parse()

	data, err := os.ReadFile(*tokensFile)
	if err != nil {
		log.Fatalf("read %s: %v", *tokensFile, err)
	}
	var tokens []tokenRecord
	if err := json.Unmarshal(data, &tokens); err != nil {
		log.Fatalf("parse %s: %v", *tokensFile, err)
	}
	fmt.Printf("loaded %d devices from %s\n", len(tokens), *tokensFile)

	client := &http.Client{Timeout: 15 * time.Second}
	samples := make(chan sample, 100000)
	var reqCount, errCount int64

	ctx, cancel := context.WithTimeout(context.Background(), *duration)
	defer cancel()

	var wg sync.WaitGroup
	for _, tok := range tokens {
		wg.Add(1)
		go func(tok tokenRecord) {
			defer wg.Done()
			auth := "Bearer " + tok.DeviceID + ":" + tok.AgentKey

			rulesTicker := time.NewTicker(*rulesInterval)
			activityTicker := time.NewTicker(*activityInterval)
			heartbeatTicker := time.NewTicker(*heartbeatInterval)
			defer rulesTicker.Stop()
			defer activityTicker.Stop()
			defer heartbeatTicker.Stop()

			do := func(endpoint, method, path string, body []byte) {
				start := time.Now()
				var req *http.Request
				var err error
				if body != nil {
					req, err = http.NewRequestWithContext(ctx, method, *baseURL+path, bytes.NewReader(body))
					req.Header.Set("Content-Type", "application/json")
				} else {
					req, err = http.NewRequestWithContext(ctx, method, *baseURL+path, nil)
				}
				if err != nil {
					return
				}
				req.Header.Set("Authorization", auth)
				resp, err := client.Do(req)
				elapsed := time.Since(start).Seconds() * 1000
				atomic.AddInt64(&reqCount, 1)
				if err != nil {
					atomic.AddInt64(&errCount, 1)
					samples <- sample{endpoint, elapsed, 0}
					return
				}
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				if resp.StatusCode >= 400 {
					atomic.AddInt64(&errCount, 1)
				}
				samples <- sample{endpoint, elapsed, resp.StatusCode}
			}

			activityBody, _ := json.Marshal([]map[string]any{
				{"event_type": "web_request", "action": "logged", "target": "example.com", "target_domain": "example.com"},
			})

			for {
				select {
				case <-ctx.Done():
					return
				case <-rulesTicker.C:
					do("GetRules", "GET", "/internal/agent/rules", nil)
				case <-activityTicker.C:
					do("ReportActivity", "POST", "/internal/agent/activity", activityBody)
				case <-heartbeatTicker.C:
					do("Heartbeat", "POST", "/internal/agent/heartbeat", []byte(`{"status":"online"}`))
				}
			}
		}(tok)
	}

	go func() {
		wg.Wait()
		close(samples)
	}()

	byEndpoint := map[string][]float64{}
	statusCounts := map[string]map[int]int{}
	for s := range samples {
		byEndpoint[s.endpoint] = append(byEndpoint[s.endpoint], s.ms)
		if statusCounts[s.endpoint] == nil {
			statusCounts[s.endpoint] = map[int]int{}
		}
		statusCounts[s.endpoint][s.status]++
	}

	fmt.Printf("\n=== load-test result [%s] — %d devices, %s ===\n", *label, len(tokens), duration.String())
	fmt.Printf("total requests: %d, errors: %d (%.2f%%)\n\n", reqCount, errCount, 100*float64(errCount)/float64(max64(reqCount, 1)))

	names := make([]string, 0, len(byEndpoint))
	for k := range byEndpoint {
		names = append(names, k)
	}
	sort.Strings(names)

	fmt.Printf("%-16s %8s %10s %10s %10s %10s\n", "endpoint", "count", "p50(ms)", "p95(ms)", "p99(ms)", "max(ms)")
	for _, name := range names {
		vals := byEndpoint[name]
		sort.Float64s(vals)
		p50 := pct(vals, 0.50)
		p95 := pct(vals, 0.95)
		p99 := pct(vals, 0.99)
		max := vals[len(vals)-1]
		fmt.Printf("%-16s %8d %10.2f %10.2f %10.2f %10.2f\n", name, len(vals), p50, p95, p99, max)
	}

	fmt.Println("\nstatus code breakdown:")
	for _, name := range names {
		fmt.Printf("  %-16s %v\n", name, statusCounts[name])
	}
}

func pct(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(p * float64(len(sorted)-1))
	return sorted[idx]
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
