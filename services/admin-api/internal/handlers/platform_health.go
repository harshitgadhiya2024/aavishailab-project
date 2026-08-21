package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// PlatformHealthHandler surfaces the Prometheus scrape data that already
// exists (every service in docker-compose.yml is scraped) but that, before
// this, no page in the superadmin dashboard ever looked at — an admin
// wanting to know if a service was down had to open Grafana directly, which
// superadmin users aren't even given credentials for.
type PlatformHealthHandler struct {
	httpClient *http.Client
}

func NewPlatformHealthHandler() *PlatformHealthHandler {
	return &PlatformHealthHandler{httpClient: &http.Client{Timeout: 5 * time.Second}}
}

func prometheusURL() string {
	if u := os.Getenv("PROMETHEUS_URL"); u != "" {
		return u
	}
	return "http://prometheus:6090"
}

type promVector struct {
	Status string `json:"status"`
	Data   struct {
		Result []struct {
			Metric map[string]string `json:"metric"`
			Value  [2]any            `json:"value"`
		} `json:"result"`
	} `json:"data"`
}

func (h *PlatformHealthHandler) query(query string) (*promVector, error) {
	req, err := http.NewRequest(http.MethodGet, prometheusURL()+"/api/v1/query", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("query", query)
	req.URL.RawQuery = q.Encode()

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var v promVector
	if err := json.Unmarshal(body, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

type serviceHealth struct {
	Job                string  `json:"job"`
	Up                 bool    `json:"up"`
	LastScrapeSeconds  float64 `json:"last_scrape_duration_seconds"`
}

// Get handles GET /superadmin/system-health. Uses only the `up` and
// `scrape_duration_seconds` series Prometheus generates for every target
// automatically — those exist regardless of what metric names each service
// happens to export on its own /metrics, so this stays correct even though
// admin-api, the Python services, and the Rust services each name their own
// request/latency metrics differently.
func (h *PlatformHealthHandler) Get(c *gin.Context) {
	upResult, upErr := h.query("up")
	if upErr != nil {
		c.JSON(http.StatusOK, gin.H{
			"reachable": false,
			"error":     "Could not reach Prometheus: " + upErr.Error(),
			"services":  []serviceHealth{},
		})
		return
	}

	scrapeDur := map[string]float64{}
	if durResult, err := h.query("scrape_duration_seconds"); err == nil {
		for _, r := range durResult.Data.Result {
			if job, ok := r.Metric["job"]; ok {
				if s, ok := r.Value[1].(string); ok {
					if f, err := strconv.ParseFloat(s, 64); err == nil {
						scrapeDur[job] = f
					}
				}
			}
		}
	}

	services := make([]serviceHealth, 0, len(upResult.Data.Result))
	for _, r := range upResult.Data.Result {
		job := r.Metric["job"]
		if job == "" {
			continue
		}
		up := false
		if s, ok := r.Value[1].(string); ok {
			up = s == "1"
		}
		services = append(services, serviceHealth{
			Job:               job,
			Up:                up,
			LastScrapeSeconds: scrapeDur[job],
		})
	}
	sort.Slice(services, func(i, j int) bool { return services[i].Job < services[j].Job })

	upCount := 0
	for _, s := range services {
		if s.Up {
			upCount++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"reachable":  true,
		"services":   services,
		"up_count":   upCount,
		"total":      len(services),
		"checked_at": time.Now().UTC(),
	})
}
