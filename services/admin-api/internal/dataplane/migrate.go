package dataplane

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
)

// MoveHistory copies an organization's existing employee data out of
// Aavishield's storage into the company's own, then deletes Aavishield's copy.
//
// Turning data residency on routes new data; this is what makes it true of
// the past as well. It runs in the background and is safe to re-run: rows are
// copied under their original IDs, so a second pass skips what the first one
// already wrote, and nothing is deleted from Aavishield until every row and
// image has been copied.
//
// Database rows move when the company's database is connected; screenshot
// images move when its bucket is connected (with only a bucket connected, the
// rows stay in Aavishield's database and are re-pointed at the moved images).
func MoveHistory(orgID uuid.UUID) error {
	m := mgr()
	res := m.db.Model(&models.OrgDataResidency{}).
		Where("org_id = ? AND enabled = true AND (migration_status IS NULL OR migration_status <> ?)", orgID, models.ResidencyMigrationRunning).
		Updates(map[string]any{
			"migration_status":      models.ResidencyMigrationRunning,
			"migration_error":       "",
			"migration_progress":    map[string]any{},
			"migration_started_at":  time.Now(),
			"migration_finished_at": nil,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("a move is already running, or data residency is off")
	}
	Invalidate(orgID)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				finishMove(orgID, nil, fmt.Errorf("unexpected failure: %v", r))
			}
		}()
		mv := &mover{org: orgID, progress: map[string]any{}}
		err := mv.run(context.Background())
		finishMove(orgID, mv.progress, err)
	}()
	return nil
}

func finishMove(orgID uuid.UUID, progress map[string]any, err error) {
	updates := map[string]any{"migration_finished_at": time.Now(), "migration_status": models.ResidencyMigrationDone, "migration_error": ""}
	if progress != nil {
		updates["migration_progress"] = progress
	}
	if err != nil {
		updates["migration_status"] = models.ResidencyMigrationFailed
		updates["migration_error"] = err.Error()
		log.Printf("dataplane: org %s history move failed: %v", orgID, err)
	} else {
		log.Printf("dataplane: org %s history moved: %v", orgID, progress)
	}
	mgr().db.Model(&models.OrgDataResidency{}).Where("org_id = ?", orgID).Updates(updates)
	Invalidate(orgID)
}

type mover struct {
	org      uuid.UUID
	progress map[string]any
	last     time.Time
}

func (mv *mover) set(k string, v any) {
	mv.progress[k] = v
	if time.Since(mv.last) > 2*time.Second {
		mv.last = time.Now()
		mgr().db.Model(&models.OrgDataResidency{}).Where("org_id = ?", mv.org).Update("migration_progress", mv.progress)
	}
}

func (mv *mover) run(ctx context.Context) error {
	m := mgr()
	row, err := Residency(ctx, mv.org)
	if err != nil || row == nil {
		return errors.New("data residency is not configured")
	}
	var dst Store
	if row.DBActive() {
		st, tenant, err := m.resolve(ctx, mv.org)
		if err != nil {
			return err
		}
		if !tenant {
			return errors.New("your database is not connected")
		}
		dst = st
	}
	moveImages := row.FilesActive()
	if dst == nil && !moveImages {
		return errors.New("connect a database or file storage first")
	}
	src := m.primary
	q := EventQuery{OrgID: mv.org, Ascending: true}

	// Totals first, so the page can show a real progress bar.
	if dst != nil {
		n, err := src.CountEvents(ctx, q)
		if err != nil {
			return err
		}
		mv.set("events_total", n)
	}
	var shotsTotal int64
	m.db.Model(&models.Screenshot{}).Where("org_id = ?", mv.org).Count(&shotsTotal)
	mv.set("screenshots_total", shotsTotal)

	// 1. Activity events.
	if dst != nil {
		copied := 0
		batch := make([]*models.ActivityEvent, 0, 500)
		flush := func() error {
			if len(batch) == 0 {
				return nil
			}
			if err := insertSkippingDuplicates(ctx, dst, batch); err != nil {
				return fmt.Errorf("copying activity: %w", err)
			}
			copied += len(batch)
			mv.set("events_copied", copied)
			batch = batch[:0]
			return nil
		}
		err := src.EachEvent(ctx, q, func(ev *models.ActivityEvent) error {
			e := *ev
			batch = append(batch, &e)
			if len(batch) == cap(batch) {
				return flush()
			}
			return nil
		})
		if err == nil {
			err = flush()
		}
		if err != nil {
			return err
		}
	}

	// 2. Work sessions.
	var sessions []models.WorkSession
	if dst != nil {
		var err error
		sessions, err = src.FindSessions(ctx, SessionQuery{OrgID: mv.org})
		if err != nil {
			return err
		}
		for i := range sessions {
			if err := dst.InsertSession(ctx, &sessions[i]); err != nil && !isDuplicateKey(err) {
				return fmt.Errorf("copying work sessions: %w", err)
			}
		}
		mv.set("sessions_copied", len(sessions))
	}

	// 3. Screenshots: image first, then the row that points at it.
	var movedKeys []string
	var shotIDs []uuid.UUID
	copiedShots := 0
	cursor := time.Time{}
	seenAtCursor := map[uuid.UUID]bool{}
	for {
		page, err := src.FindScreenshots(ctx, ScreenshotQuery{OrgID: mv.org, CapturedSince: cursor, Limit: 200})
		if err != nil {
			return err
		}
		progressed := false
		for i := range page {
			s := page[i]
			if seenAtCursor[s.ID] {
				continue
			}
			progressed = true
			if !s.CapturedAt.Equal(cursor) {
				cursor, seenAtCursor = s.CapturedAt, map[uuid.UUID]bool{}
			}
			seenAtCursor[s.ID] = true

			oldKey := s.StorageKey
			if moveImages && !IsTenantKey(oldKey) {
				newKey, err := copyObject(ctx, mv.org, oldKey)
				if err != nil {
					return fmt.Errorf("copying screenshot image: %w", err)
				}
				if newKey != "" {
					s.StorageKey = newKey
					movedKeys = append(movedKeys, oldKey)
				}
			}
			if dst != nil {
				if err := dst.InsertScreenshot(ctx, &s); err != nil && !isDuplicateKey(err) {
					return fmt.Errorf("copying screenshot records: %w", err)
				}
			} else if s.StorageKey != oldKey {
				// Rows stay here; point them at the moved image.
				m.db.Model(&models.Screenshot{}).Where("id = ?", s.ID).Update("storage_key", s.StorageKey)
			}
			shotIDs = append(shotIDs, s.ID)
			copiedShots++
			mv.set("screenshots_copied", copiedShots)
		}
		if !progressed || len(page) < 200 {
			break
		}
	}

	// 4. Everything is in the company's storage: remove Aavishield's copy.
	if dst != nil {
		if _, err := src.DeleteEvents(ctx, EventQuery{OrgID: mv.org}); err != nil {
			return fmt.Errorf("removing Aavishield's copy of activity: %w", err)
		}
		if _, err := src.DeleteScreenshots(ctx, ScreenshotQuery{OrgID: mv.org}); err != nil {
			return fmt.Errorf("removing Aavishield's copy of screenshots: %w", err)
		}
		if _, err := src.DeleteSessions(ctx, SessionQuery{OrgID: mv.org}); err != nil {
			return fmt.Errorf("removing Aavishield's copy of work sessions: %w", err)
		}
	}
	for _, k := range movedKeys {
		if err := m.primaryFiles.Delete(k); err != nil {
			log.Printf("dataplane: org %s could not delete moved image %s: %v", mv.org, k, err)
		}
	}
	mv.progress["images_moved"] = len(movedKeys)
	_ = shotIDs
	return nil
}

// copyObject moves one image from Aavishield's storage into the company's
// bucket and returns its new stored key ("" if the source is already gone).
func copyObject(ctx context.Context, orgID uuid.UUID, key string) (string, error) {
	rc, ct, err := mgr().primaryFiles.Open(ctx, key)
	if err != nil {
		return "", nil // an image already lost can't be moved; keep the row
	}
	data, err := io.ReadAll(io.LimitReader(rc, 32<<20))
	rc.Close()
	if err != nil {
		return "", err
	}
	if ct == "" {
		ct = "image/webp"
	}
	return PutFile(ctx, orgID, key, ct, data)
}

func insertSkippingDuplicates(ctx context.Context, st Store, batch []*models.ActivityEvent) error {
	err := st.InsertEvents(ctx, batch)
	if err == nil || !isDuplicateKey(err) {
		return err
	}
	for _, ev := range batch {
		if err := st.InsertEvents(ctx, []*models.ActivityEvent{ev}); err != nil && !isDuplicateKey(err) {
			return err
		}
	}
	return nil
}
