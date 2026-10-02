package dataplane

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/aavishield/admin-api/internal/storage"
	"github.com/google/uuid"
)

// Check is the result of a "Test connection": each step it ran, in order,
// stopping at the first that failed.
type Check struct {
	OK    bool        `json:"ok"`
	Steps []CheckStep `json:"steps"`
	Error string      `json:"error,omitempty"`
}

// CheckStep is one line of the checklist the settings page shows.
type CheckStep struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

func (c *Check) step(id, label string, err error) bool {
	s := CheckStep{ID: id, Label: label, OK: err == nil}
	if err != nil {
		s.Detail = err.Error()
		c.Error = err.Error()
	}
	c.Steps = append(c.Steps, s)
	return err == nil
}

// TestDB connects to a company's database, creates Aavishield's tables and
// proves read, write, update and delete — every permission the feature
// needs — before anything is saved.
func TestDB(ctx context.Context, cfg *DBConfig) Check {
	var c Check
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	st, err := openDB(ctx, cfg)
	if !c.step("open", "Settings are valid", err) {
		return c
	}
	defer st.Close()

	pingCtx, cancelPing := context.WithTimeout(ctx, 15*time.Second)
	err = st.Ping(pingCtx)
	cancelPing()
	if err != nil {
		err = describeConnectError(err, cfg)
	}
	if !c.step("connect", "Reach the server and sign in", err) {
		return c
	}
	if !c.step("schema", "Create Aavishield's tables", st.ensureSchema(ctx)) {
		return c
	}
	if !c.step("permissions", "Read, write and delete", st.probe(ctx)) {
		return c
	}
	c.OK = true
	return c
}

// TestFiles writes a small object to a company's bucket, reads it back
// through the same kind of signed link the dashboard uses for screenshots,
// and deletes it.
func TestFiles(ctx context.Context, cfg *FilesConfig) Check {
	var c Check
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	b, err := openFiles(ctx, cfg)
	if !c.step("open", "Settings are valid", err) {
		return c
	}
	key := "aavishield-healthcheck/" + uuid.NewString() + ".txt"
	body := []byte("Aavishield connection test — safe to delete. " + time.Now().UTC().Format(time.RFC3339))

	if !c.step("write", "Upload a test file (write)", b.Put(ctx, key, "text/plain", body)) {
		return c
	}
	if !c.step("read", "Open it through a signed link (read)", readBack(ctx, b, key, body)) {
		_ = b.Delete(key)
		return c
	}
	if !c.step("delete", "Delete it (delete)", b.Delete(key)) {
		return c
	}
	c.OK = true
	return c
}

func readBack(ctx context.Context, b storage.Backend, key string, want []byte) error {
	u, err := b.SignedURL(key, 2*time.Minute)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	resp, err := guardedHTTPClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	got, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("the bucket refused the signed link (HTTP %d). Check the key may read objects and that the region is right: %s",
			resp.StatusCode, truncate(string(got), 300))
	}
	if !bytes.Equal(got, want) {
		return fmt.Errorf("the file read back did not match what was written")
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
