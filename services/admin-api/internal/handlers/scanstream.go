package handlers

import (
	"io"
	"log"
	"os"

	"github.com/aavishield/admin-api/internal/models"
)

// Content submitted for scanning has no size ceiling. Nothing in the product
// gets to decide that a 900MB installer or a 3GB archive is "too big to
// check" — that is precisely the file worth checking. What the size does
// change is where the bytes live while we work on them:
//
//   - the request body is spooled to a temp file as it arrives, so peak memory
//     is one 64KB buffer per in-flight scan regardless of the file;
//   - the malware path streams that file straight through to malware-service
//     (or clamd) without ever materialising it;
//   - the DLP path scans it in overlapping windows, because content detectors
//     are local patterns — a card number never spans megabytes.
//
// The only remaining hard limit belongs to clamd itself (4GB per stream, a
// protocol constraint), and past it a file is still hashed and heuristically
// analysed, just not signature-matched.
const (
	// Window handed to the DLP scorer at a time.
	dlpWindowSize = 4 * 1024 * 1024
	// Carried between windows so a pattern straddling a boundary still matches.
	// Comfortably longer than any detector's longest match.
	dlpWindowOverlap = 64 * 1024
)

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

// scanDLPStream scans spooled upload content of any size. Small content takes
// exactly the old single-shot path; anything larger is walked in overlapping
// windows and the strongest verdict wins, so a sensitive value buried 2GB into
// an archive is found rather than waved through.
func scanDLPStream(orgID, filename, contentType, destination string, spool *os.File, size int64,
	policies []models.Policy) dlpVerdict {

	if size <= dlpWindowSize {
		data := make([]byte, size)
		if _, err := io.ReadFull(spool, data); err != nil && err != io.ErrUnexpectedEOF {
			return dlpVerdict{}
		}
		return scanDLPContent(orgID, filename, contentType, destination, data, policies)
	}

	var (
		worst    dlpVerdict
		buf      = make([]byte, dlpWindowSize)
		carry    []byte
		windows  int
		offset   int64
		maxScore int
	)

	for offset < size {
		n, err := spool.Read(buf)
		if n > 0 {
			window := buf[:n]
			if len(carry) > 0 {
				window = append(append([]byte{}, carry...), window...)
			}

			v := scanDLPContent(orgID, filename, contentType, destination, window, policies)
			windows++
			if v.matched && (v.score > maxScore || !worst.matched) {
				worst, maxScore = v, v.score
			}
			// A block is terminal — no later window can produce a stronger
			// outcome, and there is no reason to keep scanning gigabytes.
			if v.action == "block" {
				log.Printf("DLP: blocked %s at window %d (%d bytes scanned of %d)",
					filename, windows, offset+int64(n), size)
				return v
			}

			if n >= dlpWindowOverlap {
				carry = append([]byte{}, buf[n-dlpWindowOverlap:n]...)
			} else {
				carry = append([]byte{}, buf[:n]...)
			}
			offset += int64(n)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
	}
	return worst
}
