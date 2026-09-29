package handlers

import (
	"io"
	"os"
)

// Content submitted for scanning has no size ceiling, so the request body is
// spooled to a temp file as it arrives rather than held in memory: peak
// memory is one copy buffer per in-flight scan whatever the file. The
// malware path streams that file to malware-service; the DLP path streams
// it to dlp-service, which does all extraction and detection itself.

// spoolBody drains r into a temp file and returns it positioned at the start,
// along with its length. The caller closes it; the file is unlinked
// immediately so it disappears even if the process dies mid-scan.
func spoolBody(r io.Reader) (*os.File, int64, error) {
	f, err := os.CreateTemp("", "aavishield-scan-*")
	if err != nil {
		return nil, 0, err
	}
	// Unlink now: the open descriptor keeps the data reachable, but nothing
	// sensitive is left behind on disk after this handler returns.
	_ = os.Remove(f.Name())

	size, err := io.Copy(f, r)
	if err != nil {
		f.Close()
		return nil, 0, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		f.Close()
		return nil, 0, err
	}
	return f, size, nil
}
