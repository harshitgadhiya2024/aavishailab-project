package riskengine

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"
)

// Minimal ClamAV client speaking the clamd INSTREAM protocol directly over
// TCP (no client library needed) — real, open-source, signature-based
// malware scanning (viruses, trojans, worms, ransomware families ClamAV's
// database recognizes), running entirely on infrastructure we control.
//
// Honest limitation: this only ever sees plain HTTP downloads. Scanning
// HTTPS downloads would require decrypting the connection (the same Root CA
// / MITM project discussed separately) — that's not part of this piece.

const (
	clamdChunkSize = 64 * 1024
	clamdTimeout   = 5 * time.Minute

	// clamd clamps its own MaxFileSize to 2GB-3 whatever the config says, and
	// beyond that it scans a prefix and answers OK — a clean verdict for a file
	// it only half-read. Refusing above the limit reports "not scanned" instead,
	// which the caller can act on honestly.
	//
	// This is not a product-level size cap: content streams through here, so a
	// large download costs time and scratch space, never memory.
	ClamdStreamLimit int64 = 2147483645
)

type ScanResult struct {
	Infected  bool
	Signature string
	Scanned   bool // false if clamd was unreachable — caller should fail open
}

func clamdAddr() string {
	host := os.Getenv("CLAMAV_HOST")
	if host == "" {
		host = "localhost"
	}
	port := os.Getenv("CLAMAV_PORT")
	if port == "" {
		port = "3310"
	}
	return net.JoinHostPort(host, port)
}

// ScanBytes submits data to clamd over the INSTREAM protocol and returns the
// verdict. If clamd can't be reached, Scanned=false — callers must treat
// that as "couldn't check," not "clean," and fail open the same way the rest
// of this system does when a signal is unavailable.
func ScanBytes(data []byte) ScanResult {
	return ScanReader(bytes.NewReader(data), int64(len(data)))
}

// ScanReader streams content to clamd chunk by chunk. size may be -1 when it
// isn't known up front; it is only used to reject something clamd would refuse
// anyway. Nothing here buffers the whole stream.
func ScanReader(src io.Reader, size int64) ScanResult {
	if size >= 0 && size > ClamdStreamLimit {
		return ScanResult{Scanned: false}
	}

	conn, err := net.DialTimeout("tcp", clamdAddr(), clamdTimeout)
	if err != nil {
		return ScanResult{Scanned: false}
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(clamdTimeout))

	if _, err := conn.Write([]byte("zINSTREAM\x00")); err != nil {
		return ScanResult{Scanned: false}
	}

	buf := make([]byte, clamdChunkSize)
	lenBuf := make([]byte, 4)
	var sent int64
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			sent += int64(n)
			if sent > ClamdStreamLimit {
				return ScanResult{Scanned: false}
			}
			binary.BigEndian.PutUint32(lenBuf, uint32(n))
			if _, err := conn.Write(lenBuf); err != nil {
				return ScanResult{Scanned: false}
			}
			if _, err := conn.Write(buf[:n]); err != nil {
				return ScanResult{Scanned: false}
			}
			// Each chunk refreshes the clock: the deadline is meant to catch a
			// stalled peer, not to cap how long a legitimately huge file takes.
			conn.SetDeadline(time.Now().Add(clamdTimeout))
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return ScanResult{Scanned: false}
		}
	}

	// Zero-length chunk signals end of stream.
	if _, err := conn.Write([]byte{0, 0, 0, 0}); err != nil {
		return ScanResult{Scanned: false}
	}

	// zINSTREAM responses are NUL-terminated, not newline-terminated.
	reader := bufio.NewReader(conn)
	line, err := reader.ReadString('\x00')
	if err != nil {
		return ScanResult{Scanned: false}
	}
	line = strings.TrimSpace(strings.TrimSuffix(line, "\x00"))

	// clamd responds "stream: OK" or "stream: <Signature-Name> FOUND"
	if strings.HasSuffix(line, "FOUND") {
		sig := strings.TrimSuffix(line, " FOUND")
		if idx := strings.Index(sig, ": "); idx >= 0 {
			sig = sig[idx+2:]
		}
		return ScanResult{Infected: true, Signature: sig, Scanned: true}
	}
	return ScanResult{Infected: false, Scanned: true}
}

// Ping checks clamd is reachable (used at startup so operators see a clear
// log line instead of silently fail-open scans forever).
func Ping() error {
	conn, err := net.DialTimeout("tcp", clamdAddr(), 5*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Write([]byte("PING\n")); err != nil {
		return err
	}
	reader := bufio.NewReader(conn)
	resp, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	if !strings.Contains(resp, "PONG") {
		return fmt.Errorf("unexpected clamd response: %q", resp)
	}
	return nil
}
