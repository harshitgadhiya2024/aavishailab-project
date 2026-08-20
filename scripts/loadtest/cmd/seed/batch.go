package main

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pgxBatchWriter batches inserts to avoid one round-trip per row when
// seeding thousands of devices.
type pgxBatchWriter struct {
	ctx   context.Context
	pool  *pgxpool.Pool
	batch pgx.Batch
}

func (w *pgxBatchWriter) queue(sql string, args ...any) {
	w.batch.Queue(sql, args...)
}

func (w *pgxBatchWriter) flush() error {
	if w.batch.Len() == 0 {
		return nil
	}
	br := w.pool.SendBatch(w.ctx, &w.batch)
	defer br.Close()
	for i := 0; i < w.batch.Len(); i++ {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	w.batch = pgx.Batch{}
	return nil
}
