package authpolicy

import (
	"context"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Login is IP-rate-limited at the router, but that does nothing against a
// password-spray spread across many IPs aimed at one account. Lockout adds the
// per-account dimension: after MaxFailures wrong passwords for one identity
// inside FailureWindow, that account is refused for LockDuration regardless of
// source IP. A correct sign-in clears the counter.
//
// It is best-effort and fails open — if Redis is unavailable, sign-in still
// works (the IP limiter remains), because the cache being down must not lock
// everyone out of the product.
const (
	MaxFailures   = 8
	FailureWindow = 15 * time.Minute
	LockDuration  = 15 * time.Minute
)

// Lockout tracks failed sign-ins per account.
type Lockout struct{ rdb *redis.Client }

func NewLockout(rdb *redis.Client) *Lockout { return &Lockout{rdb: rdb} }

func key(scope, identity string) string {
	return "lockout:" + scope + ":" + strings.ToLower(strings.TrimSpace(identity))
}

// Locked reports whether this identity is currently locked, and for how much
// longer. scope separates the surfaces ("company", "superadmin", "portal") so
// a lock on one doesn't bleed into another.
func (l *Lockout) Locked(ctx context.Context, scope, identity string) (bool, time.Duration) {
	if l == nil || l.rdb == nil {
		return false, 0
	}
	ttl, err := l.rdb.PTTL(ctx, key(scope, identity)+":locked").Result()
	if err != nil || ttl <= 0 {
		return false, 0
	}
	return true, ttl
}

// Fail records a wrong password. When the count crosses MaxFailures it sets the
// lock. Safe on a nil receiver / nil Redis.
func (l *Lockout) Fail(ctx context.Context, scope, identity string) {
	if l == nil || l.rdb == nil {
		return
	}
	k := key(scope, identity)
	n, err := l.rdb.Incr(ctx, k+":fails").Result()
	if err != nil {
		return
	}
	if n == 1 {
		l.rdb.Expire(ctx, k+":fails", FailureWindow)
	}
	if n >= MaxFailures {
		l.rdb.Set(ctx, k+":locked", "1", LockDuration)
		l.rdb.Del(ctx, k+":fails")
	}
}

// Reset clears the counters after a successful sign-in.
func (l *Lockout) Reset(ctx context.Context, scope, identity string) {
	if l == nil || l.rdb == nil {
		return
	}
	k := key(scope, identity)
	l.rdb.Del(ctx, k+":fails", k+":locked")
}
