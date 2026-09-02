package handlers

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/aavishield/admin-api/internal/aiclient"
	"github.com/aavishield/admin-api/internal/dlpclient"
	"github.com/aavishield/admin-api/internal/extractclient"
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
//
// A second axis was added alongside extract-service (see extractclient):
// when it's configured, the spooled body is first walked by extract-service
// into real text segments (a DOCX's paragraphs, an XLSX's cells, OCR'd text
// from a scanned PDF page or photographed ID card, ...) and each segment is
// windowed and scanned exactly the way raw bytes always were — so the same
// dlpWindowSize/dlpWindowOverlap/block-is-terminal behavior below governs
// both paths. If extract-service is unavailable, disabled, or errors
// mid-stream, this falls back to scanning the raw spooled bytes directly
// (today's behavior, unchanged) rather than dropping the scan.
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

// audioVideoExts / mimes recognised for the transcription path. Kept small
// and explicit — anything not here just flows through the normal extract /
// raw-byte path unchanged.
var audioVideoExts = []string{
	".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".oga", ".wma",
	".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".flv", ".3gp",
}

func looksLikeMedia(filename, contentType string) bool {
	ct := strings.ToLower(contentType)
	if strings.HasPrefix(ct, "audio/") || strings.HasPrefix(ct, "video/") {
		return true
	}
	name := strings.ToLower(filename)
	for _, e := range audioVideoExts {
		if strings.HasSuffix(name, e) {
			return true
		}
	}
	return false
}

// dlpAudioMaxBytes bounds what we base64 into a single transcription call.
// Larger media is reported unscannable (reason "media_too_large"); the
// async deep-scan queue, when enabled, picks those up out of band.
func dlpAudioMaxBytes() int64 {
	if v := os.Getenv("DLP_AUDIO_MAX_BYTES"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return 24 * 1024 * 1024
}

// scanDLPMediaVerdict transcribes an audio/video upload via ai-service and
// runs the transcript through the ordinary detector + ai_text pipeline,
// folding an ai_audio confidence signal in through external_matches. Returns
// a zero verdict (caller continues to the normal path) when ai-service isn't
// configured or no policy enabled ai_audio.
func scanDLPMediaVerdict(ctx context.Context, orgID, filename, contentType, destination string,
	spool *os.File, size int64, policies []models.Policy) (dlpVerdict, bool) {

	if !aiclient.Enabled() || !anyPolicyEnablesDetector(policies, "ai_audio") {
		return dlpVerdict{}, false
	}
	if size > dlpAudioMaxBytes() {
		return unscannableVerdict(extractclient.Item{
			Part: filename, Reason: "media_too_large",
			Detail: fmt.Sprintf("%d bytes exceeds DLP_AUDIO_MAX_BYTES", size),
		}, policies), true
	}
	if _, err := spool.Seek(0, io.SeekStart); err != nil {
		return dlpVerdict{}, false
	}
	raw, err := io.ReadAll(spool)
	if err != nil {
		return dlpVerdict{}, false
	}
	res, err := aiclient.Transcribe(ctx, orgID, base64.StdEncoding.EncodeToString(raw), contentType)
	if err != nil || res == nil || !res.OK || strings.TrimSpace(res.Text) == "" {
		if err != nil {
			log.Printf("transcription failed for %s: %v", filename, err)
		}
		return unscannableVerdict(extractclient.Item{
			Part: filename, Reason: "media_no_transcript",
			Detail: "speech-to-text produced no usable transcript",
		}, policies), true
	}

	t1 := scanDLPContent(ctx, orgID, filename, "text/plain", destination, []byte(res.Text), policies)
	if t1.action == "block" {
		return t1, true
	}
	external := []dlpclient.ExternalMatch{}
	if v, terr := aiclient.ClassifyText(ctx, orgID, res.Text); terr == nil && v.Sensitive {
		label := "AI Audio Classification"
		if len(v.Categories) > 0 {
			label = "AI Audio Classification: " + strings.Join(v.Categories, ", ")
		}
		external = append(external, dlpclient.ExternalMatch{
			Detector: "ai_audio", Label: label, Confidence: v.Confidence, Preview: v.Evidence,
		})
	}
	t2 := scanDLPContentExt(ctx, orgID, filename, "text/plain", destination, []byte(res.Text), policies, external)
	return moreSevereVerdict(t1, t2), true
}

// scanDLPStream scans spooled upload content of any size, preferring deep
// extraction (extract-service) when configured and falling back to raw-byte
// scanning otherwise or on error.
func scanDLPStream(ctx context.Context, orgID, filename, contentType, destination string, spool *os.File, size int64,
	policies []models.Policy) dlpVerdict {

	if looksLikeMedia(filename, contentType) {
		if v, handled := scanDLPMediaVerdict(ctx, orgID, filename, contentType, destination, spool, size, policies); handled {
			return v
		}
		if _, err := spool.Seek(0, io.SeekStart); err != nil {
			return dlpVerdict{}
		}
	}

	if extractclient.Enabled() {
		if v, ok := scanDLPStreamViaExtract(ctx, orgID, filename, contentType, destination, spool, size, policies); ok {
			return v
		}
		if _, err := spool.Seek(0, io.SeekStart); err != nil {
			return dlpVerdict{}
		}
	}
	return scanDLPStreamRaw(ctx, orgID, filename, contentType, destination, spool, size, policies)
}

// scanDLPStreamRaw is the original raw-byte path: small content takes the
// old single-shot path; anything larger is walked in overlapping windows and
// the strongest verdict wins, so a sensitive value buried 2GB into a file is
// found rather than waved through.
func scanDLPStreamRaw(ctx context.Context, orgID, filename, contentType, destination string, spool *os.File, size int64,
	policies []models.Policy) dlpVerdict {

	if size <= dlpWindowSize {
		data := make([]byte, size)
		if _, err := io.ReadFull(spool, data); err != nil && err != io.ErrUnexpectedEOF {
			return dlpVerdict{}
		}
		return scanDLPContent(ctx, orgID, filename, contentType, destination, data, policies)
	}

	buf := make([]byte, dlpWindowSize)
	windows := 0
	var offset int64
	v := windowScanChunks(ctx, orgID, filename, contentType, destination, policies, func() ([]byte, error) {
		n, err := spool.Read(buf)
		windows++
		offset += int64(n)
		return buf[:n], err
	})
	if v.action == "block" {
		log.Printf("DLP: blocked %s at window %d (%d bytes scanned of %d)", filename, windows, offset, size)
	}
	return v
}

// windowScanChunks drives the shared "window + 64KB carry, block stops
// early" pattern. nextChunk returns io.EOF (optionally with one final
// non-empty chunk) once there is nothing left to read; it's implemented
// once here and reused by both the raw-byte file path above and the
// per-segment path below, so the two can't quietly drift apart.
func windowScanChunks(ctx context.Context, orgID, filename, contentType, destination string,
	policies []models.Policy, nextChunk func() ([]byte, error)) dlpVerdict {

	var worst dlpVerdict
	var carry []byte
	maxScore := 0
	for {
		chunk, err := nextChunk()
		if len(chunk) > 0 {
			window := chunk
			if len(carry) > 0 {
				window = append(append([]byte{}, carry...), chunk...)
			}
			v := scanDLPContent(ctx, orgID, filename, contentType, destination, window, policies)
			if v.matched && (v.score > maxScore || !worst.matched) {
				worst, maxScore = v, v.score
			}
			// A block is terminal — no later window can produce a stronger
			// outcome, and there is no reason to keep scanning gigabytes.
			if v.action == "block" {
				return v
			}
			if len(chunk) >= dlpWindowOverlap {
				carry = append([]byte{}, chunk[len(chunk)-dlpWindowOverlap:]...)
			} else {
				carry = append([]byte{}, chunk...)
			}
		}
		if err != nil {
			break
		}
	}
	return worst
}

// scanDLPStreamViaExtract streams the spooled body through extract-service
// and scans each segment as it arrives, in extraction order, stopping the
// moment any segment (or unscannable-part policy resolution) blocks — which
// also tells extract-service to stop walking the rest of the content, since
// closing the response body early ends its generator on the other side.
//
// The second return value is false when extract-service itself couldn't be
// reached or errored mid-stream (auth failure, 5xx, transport error) — the
// caller falls back to raw-byte scanning in that case rather than treating
// "extraction failed" as "content is clean".
func scanDLPStreamViaExtract(ctx context.Context, orgID, filename, contentType, destination string, spool *os.File, size int64,
	policies []models.Policy) (dlpVerdict, bool) {

	var worst dlpVerdict
	maxScore := 0
	consider := func(v dlpVerdict) bool {
		if v.matched && (v.score > maxScore || !worst.matched) {
			worst, maxScore = v, v.score
		}
		return v.action == "block"
	}

	_, err := extractclient.Stream(ctx, orgID, filename, contentType, spool, size,
		true /* ocrEnabled */, true /* imagesEnabled */, 0,
		func(item extractclient.Item) bool {
			switch item.Kind {
			case "segment":
				return consider(scanDLPSegmentWindowed(ctx, orgID, item, destination, policies))
			case "unscannable":
				log.Printf("extract-service: unscannable part=%s reason=%s detail=%s",
					item.Part, item.Reason, item.Detail)
				return consider(unscannableVerdict(item, policies))
			case "image":
				return consider(scanImageVerdict(ctx, orgID, item, destination, policies))
			default:
				return false
			}
		})
	if err != nil {
		log.Printf("extract-service stream failed for %s (%v) — falling back to raw-byte DLP scan", filename, err)
		return dlpVerdict{}, false
	}
	return worst, true
}

// scanDLPSegmentWindowed scans one extracted segment, windowing it exactly
// like the raw-byte path if it's larger than dlpWindowSize. Crucially, this
// uses the segment's OWN filename/mime — e.g. "salary.docx" from inside a
// zip, or the real filename of a multipart upload part — rather than the
// outer request's filename, which is what makes source_code detection and
// bypass_file_types finally judge the right file for nested/multipart
// content instead of the historically-wrong outer name.
//
// Two tiers: the checksum/regex detectors (dlp-service-rust) always run —
// instant, free, near-zero false positives on structured identifiers. Then,
// only if that did not already block AND a policy enabled the "ai_text"
// detector, the segment text is sent to ai-service's LLM classifier for the
// class of leak that has no pattern (salary sheets, contracts, customer PII
// lists, board-deck financials). The classifier's confidence scales the
// policy's ai_text weight through the same external_matches path vision uses.
func scanDLPSegmentWindowed(ctx context.Context, orgID string, item extractclient.Item, destination string,
	policies []models.Policy) dlpVerdict {

	data := []byte(item.Text)
	filename := item.Filename
	if filename == "" {
		filename = item.Part
	}

	var t1 dlpVerdict
	if len(data) <= dlpWindowSize {
		t1 = scanDLPContent(ctx, orgID, filename, item.Mime, destination, data, policies)
	} else {
		offset := 0
		t1 = windowScanChunks(ctx, orgID, filename, item.Mime, destination, policies, func() ([]byte, error) {
			if offset >= len(data) {
				return nil, io.EOF
			}
			end := offset + dlpWindowSize
			if end > len(data) {
				end = len(data)
			}
			chunk := data[offset:end]
			offset = end
			if offset >= len(data) {
				return chunk, io.EOF
			}
			return chunk, nil
		})
	}
	if t1.action == "block" {
		return t1 // already terminal — don't spend an LLM call to say so louder
	}

	t2 := classifyTextSegment(ctx, orgID, filename, item.Mime, destination, data, policies)
	return moreSevereVerdict(t1, t2)
}

// classifyTextSegment is the LLM tier for an extracted text segment. Returns
// a zero (non-matched) verdict when ai-service is not configured, no policy
// enabled ai_text, the classifier says "not sensitive", or the call fails —
// every one of those degrades to "tier-1 verdict stands", never an error.
func classifyTextSegment(ctx context.Context, orgID, filename, mime, destination string, data []byte,
	policies []models.Policy) dlpVerdict {

	if !aiclient.Enabled() || !anyPolicyEnablesDetector(policies, "ai_text") || len(data) == 0 {
		return dlpVerdict{}
	}
	verdict, err := aiclient.ClassifyText(ctx, orgID, string(data))
	if err != nil {
		log.Printf("text classification failed for %s: %v", filename, err)
		return dlpVerdict{}
	}
	if !verdict.Sensitive {
		return dlpVerdict{}
	}
	label := "AI Content Classification"
	if len(verdict.Categories) > 0 {
		label = "AI Content Classification: " + strings.Join(verdict.Categories, ", ")
	}
	external := []dlpclient.ExternalMatch{{
		Detector:   "ai_text",
		Label:      label,
		Confidence: verdict.Confidence,
		Preview:    verdict.Evidence,
	}}
	rescore := data
	if len(rescore) > dlpWindowSize {
		rescore = rescore[:dlpWindowSize]
	}
	return scanDLPContentExt(ctx, orgID, filename, mime, destination, rescore, policies, external)
}

// verdictRank orders verdicts the same way dlp-service-rust's scoring does:
// block beats alert beats log beats allow.
func verdictRank(action string) int {
	switch action {
	case "block":
		return 3
	case "alert":
		return 2
	case "log":
		return 1
	default:
		return 0
	}
}

// moreSevereVerdict returns whichever of two verdicts is stronger — higher
// action rank, then higher score. A non-matched verdict always loses to a
// matched one.
func moreSevereVerdict(a, b dlpVerdict) dlpVerdict {
	if !b.matched {
		return a
	}
	if !a.matched {
		return b
	}
	if verdictRank(b.action) > verdictRank(a.action) ||
		(verdictRank(b.action) == verdictRank(a.action) && b.score > a.score) {
		return b
	}
	return a
}

// anyPolicyEnablesDetector reports whether any applicable policy has turned
// on the named detector — the same enable/disable convention as every
// built-in detector (see the frontend's detector checklist). Gates the
// paid LLM calls entirely: an org that never opted into "ai_visual" /
// "ai_text" / "ai_audio" never triggers one, regardless of upload content.
func anyPolicyEnablesDetector(policies []models.Policy, name string) bool {
	for _, p := range policies {
		detectors, _ := p.Rules["detectors"].([]any)
		for _, d := range detectors {
			if s, ok := d.(string); ok && s == name {
				return true
			}
		}
	}
	return false
}

// scanImageVerdict classifies one extracted image via ai-service (budget,
// caching, and the actual model call all live there — see its vision.py)
// and, only if it comes back sensitive, folds that into a normal DLP
// verdict through the same weighted-scoring path as every content match —
// see scanDLPContentExt's externalMatches parameter and dlp-service-rust's
// scoring::run_detectors, which is what actually turns
// weight = base_weight * confidence/100 into a score.
func scanImageVerdict(ctx context.Context, orgID string, item extractclient.Item, destination string,
	policies []models.Policy) dlpVerdict {

	if !aiclient.Enabled() || !anyPolicyEnablesDetector(policies, "ai_visual") {
		return dlpVerdict{}
	}

	verdict, err := aiclient.ClassifyImage(ctx, orgID, item.B64, item.Mime)
	if err != nil {
		log.Printf("vision classification failed for %s: %v", item.Part, err)
		return dlpVerdict{}
	}
	if !verdict.Sensitive {
		return dlpVerdict{}
	}

	filename := item.Filename
	if filename == "" {
		filename = item.Part
	}
	external := []dlpclient.ExternalMatch{{
		Detector:   "ai_visual",
		Label:      "AI Image Classification: " + verdict.DocType,
		Confidence: verdict.Confidence,
		Preview:    verdict.DocType,
	}}
	return scanDLPContentExt(ctx, orgID, filename, item.Mime, destination, nil, policies, external)
}

// unscannableSeverity ranks on_unscannable actions so the most severe one
// configured across an org's applicable DLP policies wins, the same way
// scoring.rs's most-severe-policy-wins rule works for content matches.
var unscannableSeverity = map[string]int{"allow": 0, "log": 0, "alert": 1, "block": 2}

// resolveUnscannableAction looks up a policy's `Rules["on_unscannable"]`
// (see the policy schema v2 shape) for the given reason and returns the most
// severe action configured across all applicable policies. Defaults to
// "allow" — today's fail-open behavior — when no policy has opted into the
// setting, so upgrading to extract-service changes nothing about
// enforcement until an admin explicitly configures it.
func resolveUnscannableAction(policies []models.Policy, reason string) string {
	best := "allow"
	bestRank := 0
	for _, p := range policies {
		raw, ok := p.Rules["on_unscannable"]
		if !ok {
			continue
		}
		m, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		v, ok := m[reason]
		if !ok {
			continue
		}
		action, ok := v.(string)
		if !ok {
			continue
		}
		rank, known := unscannableSeverity[action]
		if !known {
			continue
		}
		if rank > bestRank {
			bestRank = rank
			best = action
		}
	}
	return best
}

// unscannableVerdict turns one extract-service "unscannable" record into a
// dlpVerdict, so it flows through the exact same "worst verdict wins" /
// block-is-terminal reduction as an ordinary content match — no second
// decision path to keep in sync. Returns a zero (non-matched) verdict when
// the resolved action is "allow"/"log", preserving silent-but-logged
// behavior for orgs that haven't configured on_unscannable.
func unscannableVerdict(item extractclient.Item, policies []models.Policy) dlpVerdict {
	action := resolveUnscannableAction(policies, item.Reason)
	if action != "block" && action != "alert" {
		return dlpVerdict{}
	}
	return dlpVerdict{
		matched:    true,
		score:      0,
		band:       action,
		action:     action,
		policyName: DefaultDLPPolicyName,
		detectors:  []string{"unscannable:" + item.Reason},
		previews:   []string{item.Part + ": " + item.Detail},
		reason: fmt.Sprintf("Content at %q could not be fully inspected (%s) — organization policy requires %q for this content",
			item.Part, item.Reason, action),
	}
}
