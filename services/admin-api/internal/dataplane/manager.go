package dataplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/aavishield/admin-api/internal/storage"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// manager owns the primary store and a lazily opened, cached tenant store per
// organization that has data residency switched on.
type manager struct {
	db           *gorm.DB
	rdb          *redis.Client
	primary      *sqlStore
	primaryFiles storage.Backend

	mu      sync.Mutex
	entries map[uuid.UUID]*entry
}

type entry struct {
	row      *models.OrgDataResidency // nil: the org has never configured anything
	loadedAt time.Time

	dbSealed string
	store    Store
	dbErr    error
	dbErrAt  time.Time

	filesSealed string
	files       storage.Backend
	filesErr    error
	filesErrAt  time.Time
}

const (
	// How long a residency row is trusted before being re-read. Changes made
	// through this instance invalidate immediately; this bounds how long
	// another admin-api instance can lag behind one.
	rowTTL = 30 * time.Second
	// How long a failed connection is remembered before trying again, so an
	// unreachable company database costs one timeout per interval rather than
	// one per request.
	retryAfter = 20 * time.Second
)

var std *manager

// Init wires the package to Aavishield's own database and cache. main calls
// it once, before any handler runs.
func Init(db *gorm.DB, rdb *redis.Client) {
	std = &manager{
		db:           db,
		rdb:          rdb,
		primary:      newPrimaryStore(db),
		primaryFiles: storage.New(),
		entries:      map[uuid.UUID]*entry{},
	}
}

func mgr() *manager {
	if std == nil {
		panic("dataplane.Init was not called")
	}
	return std
}

// Primary is Aavishield's own store, for platform-wide sweeps.
func Primary() Store { return mgr().primary }

// PrimaryFiles is Aavishield's own bucket (or local volume).
func PrimaryFiles() storage.Backend { return mgr().primaryFiles }

// Invalidate makes the next request re-read an org's configuration, so a
// change takes effect immediately. A connection whose settings did not change
// is kept; one that did is replaced, and the old one closed only after
// closeGrace — requests already holding it finish normally instead of
// failing with "database is closed".
func Invalidate(orgID uuid.UUID) {
	m := mgr()
	m.mu.Lock()
	if e := m.entries[orgID]; e != nil {
		e.loadedAt = time.Time{}
		e.dbErr, e.filesErr = nil, nil
	}
	m.mu.Unlock()
}

// closeGrace is how long a replaced connection stays open for requests that
// already hold it.
const closeGrace = 2 * time.Minute

func closeEntry(e *entry) {
	if e.store == nil {
		return
	}
	st := e.store
	time.AfterFunc(closeGrace, func() {
		if err := st.Close(); err != nil {
			log.Printf("dataplane: closing store: %v", err)
		}
	})
}

// Residency returns the org's configuration, or nil if it never set one up.
func Residency(ctx context.Context, orgID uuid.UUID) (*models.OrgDataResidency, error) {
	e, err := mgr().entry(ctx, orgID)
	if err != nil {
		return nil, err
	}
	return e.row, nil
}

func (m *manager) entry(ctx context.Context, orgID uuid.UUID) (*entry, error) {
	m.mu.Lock()
	e := m.entries[orgID]
	m.mu.Unlock()
	if e != nil && time.Since(e.loadedAt) < rowTTL {
		return e, nil
	}

	var row models.OrgDataResidency
	err := m.db.WithContext(ctx).Where("org_id = ?", orgID).First(&row).Error
	var rowPtr *models.OrgDataResidency
	switch {
	case err == nil:
		rowPtr = &row
	case errors.Is(err, gorm.ErrRecordNotFound):
	default:
		if e != nil {
			return e, nil // keep serving the last known configuration
		}
		return nil, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	cur := m.entries[orgID]
	next := &entry{row: rowPtr, loadedAt: time.Now()}
	if cur != nil {
		// Keep open connections whose configuration did not change.
		if rowPtr != nil && rowPtr.DBActive() && cur.dbSealed == rowPtr.DBConfigSealed {
			next.dbSealed, next.store, next.dbErr, next.dbErrAt = cur.dbSealed, cur.store, cur.dbErr, cur.dbErrAt
			cur.store = nil
		}
		if rowPtr != nil && rowPtr.FilesActive() && cur.filesSealed == rowPtr.FilesConfigSealed {
			next.filesSealed, next.files, next.filesErr, next.filesErrAt = cur.filesSealed, cur.files, cur.filesErr, cur.filesErrAt
		}
		closeEntry(cur)
	}
	m.entries[orgID] = next
	return next, nil
}

// resolve returns the store an org's employee data belongs in. tenant is true
// when that is the company's own database — including when it could not be
// reached, in which case err is ErrUnavailable (wrapped).
func (m *manager) resolve(ctx context.Context, orgID uuid.UUID) (Store, bool, error) {
	e, err := m.entry(ctx, orgID)
	if err != nil {
		return nil, false, err
	}
	if e.row == nil || !e.row.DBActive() {
		return m.primary, false, nil
	}

	m.mu.Lock()
	// Circuit open: the store failed moments ago (to connect, or mid-query —
	// see guardedStore). Fail fast until retryAfter has passed.
	if e.dbErr != nil && time.Since(e.dbErrAt) < retryAfter {
		err := e.dbErr
		m.mu.Unlock()
		return nil, true, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if e.store != nil && e.dbSealed == e.row.DBConfigSealed {
		st := e.store
		m.mu.Unlock()
		return st, true, nil
	}
	sealed := e.row.DBConfigSealed
	m.mu.Unlock()

	opened, err := openSealedDB(ctx, sealed)
	var st Store
	if err == nil {
		st = &guardedStore{Store: opened, org: orgID}
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if err != nil {
		e.dbErr, e.dbErrAt = err, time.Now()
		log.Printf("dataplane: org %s database unreachable: %v", orgID, err)
		return nil, true, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	// The entry may have been reloaded while the connection was opening; the
	// connection belongs on whichever entry is current, or it would leak.
	target := m.entries[orgID]
	if target == nil || target.row == nil || target.row.DBConfigSealed != sealed {
		target = e
	}
	if target.store != nil { // another request won the race
		closeEntry(&entry{store: st})
		return target.store, true, nil
	}
	target.store, target.dbSealed, target.dbErr = st, sealed, nil
	return st, true, nil
}

func openSealedDB(ctx context.Context, sealed string) (Store, error) {
	cfg, err := UnsealDB(sealed)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	// Opened and pinged, not re-provisioned: tables were created when the
	// company connected, and doing DDL on a request path would be wrong.
	st, err := openDB(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := st.Ping(ctx); err != nil {
		st.Close()
		return nil, describeConnectError(err, cfg)
	}
	// Bring a company database created by an older release up to the current
	// schema (new columns, indexes). Idempotent and runs once per connection;
	// a failure (e.g. the user lost ALTER rights) is logged, not fatal — reads
	// and existing writes keep working.
	if err := st.ensureSchema(ctx); err != nil {
		log.Printf("dataplane: schema upgrade skipped: %v", err)
	}
	return st, nil
}

// UnsealDB decrypts a stored database configuration.
func UnsealDB(sealed string) (*DBConfig, error) {
	raw, err := Open(sealed)
	if err != nil {
		return nil, fmt.Errorf("could not decrypt the saved database settings: %w", err)
	}
	var cfg DBConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// UnsealFiles decrypts a stored object-storage configuration.
func UnsealFiles(sealed string) (*FilesConfig, error) {
	raw, err := Open(sealed)
	if err != nil {
		return nil, fmt.Errorf("could not decrypt the saved storage settings: %w", err)
	}
	var cfg FilesConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// Events returns the store holding an org's employee data. The error is
// ErrUnavailable (wrapped) when that is the company's own database and it
// cannot be reached right now.
func Events(ctx context.Context, orgID uuid.UUID) (Store, error) {
	st, _, err := mgr().resolve(ctx, orgID)
	return st, err
}

// EventsFor is Events for an org ID still in string form, as handlers
// receive it from the request context.
func EventsFor(ctx context.Context, orgID string) (Store, error) {
	id, err := uuid.Parse(orgID)
	if err != nil {
		return nil, fmt.Errorf("invalid organization id")
	}
	return Events(ctx, id)
}

// IsTenant reports whether the org's employee data lives in its own database.
func IsTenant(ctx context.Context, orgID uuid.UUID) bool {
	e, err := mgr().entry(ctx, orgID)
	return err == nil && e.row != nil && e.row.DBActive()
}

// TenantOrgs lists organizations whose employee data lives in their own
// database, for the background sweeps that otherwise only see the primary
// store.
func TenantOrgs(ctx context.Context) ([]uuid.UUID, error) {
	var rows []models.OrgDataResidency
	err := mgr().db.WithContext(ctx).
		Select("org_id").
		Where("enabled = true AND db_provider <> '' AND db_config_sealed <> '' AND db_status <> ?", models.ResidencyStatusNotConfigured).
		Find(&rows).Error
	ids := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.OrgID)
	}
	return ids, err
}

// ─── Files ────────────────────────────────────────────────────────────────────

// Screenshot rows record where their image is. A key written to a company's
// own bucket is stored with this prefix, so every row resolves to the right
// bucket on its own — history from before the switch keeps loading from
// Aavishield's bucket, and new images from the company's — without anything
// having to remember when the switch happened.
const tenantKeyPrefix = "ext:"

// IsTenantKey reports whether a stored key points into a company's bucket.
func IsTenantKey(storedKey string) bool { return strings.HasPrefix(storedKey, tenantKeyPrefix) }

func (m *manager) tenantFiles(ctx context.Context, orgID uuid.UUID) (storage.Backend, bool, error) {
	e, err := m.entry(ctx, orgID)
	if err != nil {
		return nil, false, err
	}
	if e.row == nil || !e.row.FilesActive() {
		return nil, false, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if e.files != nil && e.filesSealed == e.row.FilesConfigSealed {
		return e.files, true, nil
	}
	if e.filesErr != nil && time.Since(e.filesErrAt) < retryAfter {
		return nil, true, fmt.Errorf("%w: %v", ErrUnavailable, e.filesErr)
	}
	cfg, err := UnsealFiles(e.row.FilesConfigSealed)
	if err == nil {
		var b storage.Backend
		b, err = openFiles(ctx, cfg)
		if err == nil {
			e.files, e.filesSealed, e.filesErr = b, e.row.FilesConfigSealed, nil
			return b, true, nil
		}
	}
	e.filesErr, e.filesErrAt = err, time.Now()
	return nil, true, fmt.Errorf("%w: %v", ErrUnavailable, err)
}

// PutFile stores an object for an org and returns the key to record — which
// carries tenantKeyPrefix when it went to the company's own bucket.
func PutFile(ctx context.Context, orgID uuid.UUID, key, contentType string, data []byte) (string, error) {
	m := mgr()
	b, tenant, err := m.tenantFiles(ctx, orgID)
	if err != nil {
		return "", err
	}
	if !tenant {
		return key, m.primaryFiles.Put(ctx, key, contentType, data)
	}
	if err := b.Put(ctx, key, contentType, data); err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return tenantKeyPrefix + key, nil
}

// fileBackend finds the bucket a stored key lives in.
func (m *manager) fileBackend(ctx context.Context, orgID uuid.UUID, storedKey string) (storage.Backend, string, error) {
	if !IsTenantKey(storedKey) {
		return m.primaryFiles, storedKey, nil
	}
	b, tenant, err := m.tenantFiles(ctx, orgID)
	if err != nil {
		return nil, "", err
	}
	if !tenant {
		return nil, "", fmt.Errorf("%w: this image is in your company's storage, which is no longer connected", ErrUnavailable)
	}
	return b, strings.TrimPrefix(storedKey, tenantKeyPrefix), nil
}

// SignedURL mints a short-lived link a browser can load the object from.
func SignedURL(ctx context.Context, orgID uuid.UUID, storedKey string, ttl time.Duration) (string, error) {
	b, key, err := mgr().fileBackend(ctx, orgID, storedKey)
	if err != nil {
		return "", err
	}
	return b.SignedURL(key, ttl)
}

// DeleteFile removes an object wherever it lives.
func DeleteFile(ctx context.Context, orgID uuid.UUID, storedKey string) error {
	b, key, err := mgr().fileBackend(ctx, orgID, storedKey)
	if err != nil {
		return err
	}
	return b.Delete(key)
}

// OpenFile streams an object back, wherever it lives.
func OpenFile(ctx context.Context, orgID uuid.UUID, storedKey string) (storage.Backend, string, error) {
	return mgr().fileBackend(ctx, orgID, storedKey)
}
