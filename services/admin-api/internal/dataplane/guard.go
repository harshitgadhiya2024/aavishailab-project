package dataplane

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
)

// A company's database can fail in the slow way — a paused VM, a saturated
// link, a firewall silently dropping packets — not just by refusing the
// connection. Without bounds, every dashboard request would then hang until
// the browser gave up, and every agent upload with it.
//
// guardedStore wraps each company store: every call gets a deadline, and an
// error that means "can't reach it" (as opposed to a bad query) trips a short
// circuit breaker on the org's entry, so the next requests fail fast with
// ErrUnavailable — reads show the outage banner, writes go to the spool —
// instead of each waiting out its own timeout.
type guardedStore struct {
	Store
	org uuid.UUID
}

const (
	readTimeout  = 20 * time.Second
	writeTimeout = 10 * time.Second
	scanTimeout  = 2 * time.Minute // reports stream a whole period
)

func (g *guardedStore) check(err error) error {
	if err == nil || !unreachable(err) {
		return err
	}
	m := mgr()
	m.mu.Lock()
	if e := m.entries[g.org]; e != nil && e.store == Store(g) {
		e.dbErr, e.dbErrAt = err, time.Now()
	}
	m.mu.Unlock()
	return fmt.Errorf("%w: %v", ErrUnavailable, err)
}

// unreachable tells connectivity failures from query errors.
func unreachable(err error) bool {
	if errors.Is(err, ErrUnavailable) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, driver.ErrBadConn) {
		return true
	}
	var ne net.Error
	if errors.As(err, &ne) {
		return true
	}
	s := strings.ToLower(err.Error())
	for _, sub := range []string{
		"connection refused", "connection reset", "broken pipe", "i/o timeout", "no route to host",
		"server selection error", "database is closed", "bad connection", "unexpected eof",
		"context deadline exceeded", "timeout",
	} {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func within(ctx context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, d)
}

func (g *guardedStore) InsertEvents(ctx context.Context, events []*models.ActivityEvent) error {
	ctx, cancel := within(ctx, writeTimeout)
	defer cancel()
	return g.check(g.Store.InsertEvents(ctx, events))
}

func (g *guardedStore) UpdateEvent(ctx context.Context, ev *models.ActivityEvent, fields ...string) error {
	ctx, cancel := within(ctx, writeTimeout)
	defer cancel()
	return g.check(g.Store.UpdateEvent(ctx, ev, fields...))
}

func (g *guardedStore) FindEvents(ctx context.Context, q EventQuery) ([]models.ActivityEvent, error) {
	ctx, cancel := within(ctx, readTimeout)
	defer cancel()
	out, err := g.Store.FindEvents(ctx, q)
	return out, g.check(err)
}

func (g *guardedStore) CountEvents(ctx context.Context, q EventQuery) (int64, error) {
	ctx, cancel := within(ctx, readTimeout)
	defer cancel()
	n, err := g.Store.CountEvents(ctx, q)
	return n, g.check(err)
}

func (g *guardedStore) GroupEvents(ctx context.Context, q EventQuery, groupBy string, limit int) ([]EventGroup, error) {
	ctx, cancel := within(ctx, readTimeout)
	defer cancel()
	out, err := g.Store.GroupEvents(ctx, q, groupBy, limit)
	return out, g.check(err)
}

func (g *guardedStore) EachEvent(ctx context.Context, q EventQuery, fn func(*models.ActivityEvent) error) error {
	ctx, cancel := within(ctx, scanTimeout)
	defer cancel()
	return g.check(g.Store.EachEvent(ctx, q, fn))
}

func (g *guardedStore) DeleteEvents(ctx context.Context, q EventQuery) (int64, error) {
	ctx, cancel := within(ctx, scanTimeout)
	defer cancel()
	n, err := g.Store.DeleteEvents(ctx, q)
	return n, g.check(err)
}

func (g *guardedStore) InsertSession(ctx context.Context, s *models.WorkSession) error {
	ctx, cancel := within(ctx, writeTimeout)
	defer cancel()
	return g.check(g.Store.InsertSession(ctx, s))
}

func (g *guardedStore) UpdateSessions(ctx context.Context, q SessionQuery, fields map[string]any) (int64, error) {
	ctx, cancel := within(ctx, writeTimeout)
	defer cancel()
	n, err := g.Store.UpdateSessions(ctx, q, fields)
	return n, g.check(err)
}

func (g *guardedStore) FindSessions(ctx context.Context, q SessionQuery) ([]models.WorkSession, error) {
	ctx, cancel := within(ctx, readTimeout)
	defer cancel()
	out, err := g.Store.FindSessions(ctx, q)
	return out, g.check(err)
}

func (g *guardedStore) DeleteSessions(ctx context.Context, q SessionQuery) (int64, error) {
	ctx, cancel := within(ctx, writeTimeout)
	defer cancel()
	n, err := g.Store.DeleteSessions(ctx, q)
	return n, g.check(err)
}

func (g *guardedStore) InsertScreenshot(ctx context.Context, s *models.Screenshot) error {
	ctx, cancel := within(ctx, writeTimeout)
	defer cancel()
	return g.check(g.Store.InsertScreenshot(ctx, s))
}

func (g *guardedStore) FindScreenshots(ctx context.Context, q ScreenshotQuery) ([]models.Screenshot, error) {
	ctx, cancel := within(ctx, readTimeout)
	defer cancel()
	out, err := g.Store.FindScreenshots(ctx, q)
	return out, g.check(err)
}

func (g *guardedStore) DeleteScreenshots(ctx context.Context, q ScreenshotQuery) (int64, error) {
	ctx, cancel := within(ctx, writeTimeout)
	defer cancel()
	n, err := g.Store.DeleteScreenshots(ctx, q)
	return n, g.check(err)
}

func (g *guardedStore) ScreenshotEmployees(ctx context.Context, orgID uuid.UUID) ([]uuid.UUID, error) {
	ctx, cancel := within(ctx, readTimeout)
	defer cancel()
	out, err := g.Store.ScreenshotEmployees(ctx, orgID)
	return out, g.check(err)
}

func (g *guardedStore) SessionRollup(ctx context.Context, sessionID uuid.UUID) (Rollup, error) {
	ctx, cancel := within(ctx, readTimeout)
	defer cancel()
	r, err := g.Store.SessionRollup(ctx, sessionID)
	return r, g.check(err)
}

func (g *guardedStore) Ping(ctx context.Context) error {
	ctx, cancel := within(ctx, writeTimeout)
	defer cancel()
	return g.Store.Ping(ctx)
}
