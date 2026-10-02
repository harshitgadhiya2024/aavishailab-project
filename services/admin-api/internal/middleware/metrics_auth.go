package middleware

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// InternalMetricsAuth gates operator-only endpoints (/metrics,
// /health/detailed) that leak the API's internal shape — route names, traffic
// volumes, component status — and so must not be anonymous even though the
// only path in from the internet is the API hostname through the tunnel.
//
// The token is METRICS_TOKEN, or INTERNAL_API_SECRET when that is unset (so an
// existing deployment needs no new secret). Fails closed: with neither set,
// the endpoint is denied rather than served openly — the opposite of the
// previous behaviour, where /metrics was world-readable.
func InternalMetricsAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		expected := os.Getenv("METRICS_TOKEN")
		if expected == "" {
			expected = os.Getenv("INTERNAL_API_SECRET")
		}
		if expected == "" {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		got := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	}
}
