// Package metrics is a zero-dependency Prometheus text-exposition
// recorder, matching the pattern already used by threatintel/posture/
// shadowit-service so admin-api doesn't need to pull in client_golang.
package metrics

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// bucketBoundsSeconds are the standard Prometheus default histogram buckets.
var bucketBoundsSeconds = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

type routeStats struct {
	count   uint64
	errors  uint64 // 5xx
	sumSecs uint64 // stored as nanoseconds via atomic, converted at export
	buckets []uint64
}

var (
	mu     sync.Mutex
	routes = map[string]*routeStats{} // key: method + " " + path
)

func statsFor(key string) *routeStats {
	mu.Lock()
	defer mu.Unlock()
	s, ok := routes[key]
	if !ok {
		s = &routeStats{buckets: make([]uint64, len(bucketBoundsSeconds))}
		routes[key] = s
	}
	return s
}

// Middleware records request count, error count, and latency histogram
// buckets per (method, route-template) — route template (not raw path)
// keeps cardinality bounded regardless of path parameters.
func Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		path := c.FullPath()
		if path == "" {
			path = "unmatched"
		}
		key := c.Request.Method + " " + path
		s := statsFor(key)

		elapsed := time.Since(start).Seconds()
		atomic.AddUint64(&s.count, 1)
		if c.Writer.Status() >= 500 {
			atomic.AddUint64(&s.errors, 1)
		}
		atomic.AddUint64(&s.sumSecs, uint64(elapsed*1e9)) // ns, converted back on export

		for i, bound := range bucketBoundsSeconds {
			if elapsed <= bound {
				atomic.AddUint64(&s.buckets[i], 1)
			}
		}
	}
}

// Handler exposes accumulated stats in Prometheus text exposition format.
func Handler(c *gin.Context) {
	mu.Lock()
	keys := make([]string, 0, len(routes))
	for k := range routes {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString("# HELP admin_api_http_requests_total Total HTTP requests.\n")
	b.WriteString("# TYPE admin_api_http_requests_total counter\n")
	for _, k := range keys {
		s := routes[k]
		method, path := splitKey(k)
		fmt.Fprintf(&b, "admin_api_http_requests_total{method=%q,route=%q} %d\n",
			method, path, atomic.LoadUint64(&s.count))
	}

	b.WriteString("# HELP admin_api_http_request_errors_total Total HTTP 5xx responses.\n")
	b.WriteString("# TYPE admin_api_http_request_errors_total counter\n")
	for _, k := range keys {
		s := routes[k]
		method, path := splitKey(k)
		fmt.Fprintf(&b, "admin_api_http_request_errors_total{method=%q,route=%q} %d\n",
			method, path, atomic.LoadUint64(&s.errors))
	}

	b.WriteString("# HELP admin_api_http_request_duration_seconds Request latency.\n")
	b.WriteString("# TYPE admin_api_http_request_duration_seconds histogram\n")
	for _, k := range keys {
		s := routes[k]
		method, path := splitKey(k)
		var cumulative uint64
		for i, bound := range bucketBoundsSeconds {
			cumulative += atomic.LoadUint64(&s.buckets[i])
			fmt.Fprintf(&b, "admin_api_http_request_duration_seconds_bucket{method=%q,route=%q,le=%q} %d\n",
				method, path, strconv.FormatFloat(bound, 'f', -1, 64), cumulative)
		}
		total := atomic.LoadUint64(&s.count)
		fmt.Fprintf(&b, "admin_api_http_request_duration_seconds_bucket{method=%q,route=%q,le=\"+Inf\"} %d\n",
			method, path, total)
		fmt.Fprintf(&b, "admin_api_http_request_duration_seconds_sum{method=%q,route=%q} %f\n",
			method, path, float64(atomic.LoadUint64(&s.sumSecs))/1e9)
		fmt.Fprintf(&b, "admin_api_http_request_duration_seconds_count{method=%q,route=%q} %d\n",
			method, path, total)
	}
	mu.Unlock()

	c.Data(http.StatusOK, "text/plain; version=0.0.4", []byte(b.String()))
}

func splitKey(key string) (method, path string) {
	i := strings.IndexByte(key, ' ')
	if i < 0 {
		return key, ""
	}
	return key[:i], key[i+1:]
}
