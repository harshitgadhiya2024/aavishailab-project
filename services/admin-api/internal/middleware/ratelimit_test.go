package middleware

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("start miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	return redis.NewClient(&redis.Options{Addr: mr.Addr()})
}

func TestRateLimitAllowsUpToLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rdb := newTestRedis(t)
	r := gin.New()
	r.Use(RateLimit(rdb, "test", 3, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.Status(200) })

	for i := 0; i < 3; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/x", nil)
		req.RemoteAddr = "1.2.3.4:1111"
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("request %d: expected 200, got %d", i+1, w.Code)
		}
	}
}

func TestRateLimitBlocksOverLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rdb := newTestRedis(t)
	r := gin.New()
	r.Use(RateLimit(rdb, "test", 3, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.Status(200) })

	for i := 0; i < 3; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/x", nil)
		req.RemoteAddr = "1.2.3.4:1111"
		r.ServeHTTP(w, req)
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/x", nil)
	req.RemoteAddr = "1.2.3.4:1111"
	r.ServeHTTP(w, req)
	if w.Code != 429 {
		t.Fatalf("4th request should be rate-limited, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Fatal("expected a Retry-After header on a 429")
	}
}

func TestRateLimitIsScopedPerIP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rdb := newTestRedis(t)
	r := gin.New()
	r.Use(RateLimit(rdb, "test", 1, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.Status(200) })

	req1 := httptest.NewRequest("GET", "/x", nil)
	req1.RemoteAddr = "1.1.1.1:1111"
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)

	req2 := httptest.NewRequest("GET", "/x", nil)
	req2.RemoteAddr = "2.2.2.2:2222"
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	if w1.Code != 200 || w2.Code != 200 {
		t.Fatalf("different IPs must not share a rate-limit bucket: got %d and %d", w1.Code, w2.Code)
	}
}

func TestRateLimitFailsOpenWhenRedisNil(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RateLimit(nil, "test", 1, time.Minute))
	r.GET("/x", func(c *gin.Context) { c.Status(200) })

	// A nil Redis client (e.g. Redis unreachable) must never take the login
	// page down — every request passes through.
	for i := 0; i < 10; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/x", nil)
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("request %d should pass through when rdb is nil, got %d", i+1, w.Code)
		}
	}
}
