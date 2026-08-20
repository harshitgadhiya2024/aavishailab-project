package middleware

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// RateLimit is a fixed-window counter (Redis INCR+EXPIRE) applied per client
// IP. Before this, /api/v1/auth/login, /api/v1/auth/register/start (which
// sends email), /api/v1/portal/login, and the rest of the public auth
// surface had no throttle at all.
//
// Fixed-window rather than a sliding/token-bucket algorithm: it allows a
// short burst right at a window boundary, which is an acceptable trade for
// how simple and cheap (one INCR) it is to run on every request across
// these endpoints. Fails open — if Redis is unavailable, requests pass
// through unthrottled rather than the login page going down because the
// cache did.
func RateLimit(rdb *redis.Client, keyPrefix string, limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if rdb == nil {
			c.Next()
			return
		}

		key := "ratelimit:" + keyPrefix + ":" + c.ClientIP()
		ctx := c.Request.Context()

		count, err := rdb.Incr(ctx, key).Result()
		if err != nil {
			c.Next()
			return
		}
		if count == 1 {
			rdb.Expire(ctx, key, window)
		}
		if count > int64(limit) {
			ttl, _ := rdb.TTL(ctx, key).Result()
			if ttl > 0 {
				c.Header("Retry-After", strconv.FormatInt(int64(ttl.Seconds())+1, 10))
			}
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many requests. Please wait and try again.",
			})
			return
		}
		c.Next()
	}
}
