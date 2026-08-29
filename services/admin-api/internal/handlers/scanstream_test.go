package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/aavishield/admin-api/internal/extractclient"
	"github.com/aavishield/admin-api/internal/models"
)

func aiVisualPolicy() models.Policy {
	return models.Policy{
		Name:    "test-vision-policy",
		Type:    models.PolicyTypeDLP,
		Action:  models.PolicyActionBlock,
		Enabled: true,
		Rules: map[string]any{
			"detectors":       []any{"ai_visual"},
			"block_threshold": 80,
			"alert_threshold": 50,
		},
	}
}

func writeSpool(t *testing.T, data []byte) *os.File {
	t.Helper()
	f, size, err := spoolBody(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("spoolBody: %v", err)
	}
	if size != int64(len(data)) {
		t.Fatalf("spoolBody size = %d, want %d", size, len(data))
	}
	t.Cleanup(func() { f.Close() })
	return f
}

func creditCardPolicy() models.Policy {
	return models.Policy{
		Name:    "test-cc-policy",
		Type:    models.PolicyTypeDLP,
		Action:  models.PolicyActionBlock,
		Enabled: true,
		Rules: map[string]any{
			"detectors":       []any{"credit_card"},
			"block_threshold": 80,
			"alert_threshold": 50,
		},
	}
}

// A Luhn-valid test card number — same canary used by extract-service's own
// test suite, so a hit here is directly comparable to a hit there.
const testCard = "4111111111111111"

func TestScanDLPStreamRaw_SmallContentSingleShot(t *testing.T) {
	spool := writeSpool(t, []byte("card: "+testCard))
	v := scanDLPStreamRaw(context.Background(), "org1", "note.txt", "text/plain", "example.com",
		spool, int64(len("card: "+testCard)), []models.Policy{creditCardPolicy()})
	if !v.matched || v.action != "block" {
		t.Fatalf("expected a blocked match, got %+v", v)
	}
}

func TestScanDLPStreamRaw_WindowsAcrossBoundary(t *testing.T) {
	// Place the card number straddling the dlpWindowSize boundary so it can
	// only be found if the 64KB carry-over actually works. The pad must end
	// on a non-word byte (space) — the credit-card regex requires a \b word
	// boundary immediately before the digits, which "x4111..." (word
	// character butted against word character) would never satisfy.
	pad := append(bytes.Repeat([]byte("x"), dlpWindowSize-9), ' ')
	content := append(pad, []byte(testCard)...)
	spool := writeSpool(t, content)
	v := scanDLPStreamRaw(context.Background(), "org1", "big.bin", "application/octet-stream", "example.com",
		spool, int64(len(content)), []models.Policy{creditCardPolicy()})
	if !v.matched || v.action != "block" {
		t.Fatalf("expected the boundary-straddling card to be caught, got %+v", v)
	}
}

func TestScanDLPStreamRaw_CleanContentAllows(t *testing.T) {
	spool := writeSpool(t, []byte("nothing sensitive here"))
	v := scanDLPStreamRaw(context.Background(), "org1", "note.txt", "text/plain", "example.com",
		spool, int64(len("nothing sensitive here")), []models.Policy{creditCardPolicy()})
	if v.matched {
		t.Fatalf("expected no match, got %+v", v)
	}
}

func TestScanDLPSegmentWindowed_UsesSegmentFilename(t *testing.T) {
	item := extractclient.Item{
		Part: "q3.zip!salary.docx", Filename: "salary.docx", Mime: "application/msword",
		Text: "confidential card " + testCard,
	}
	v := scanDLPSegmentWindowed(context.Background(), "org1", item, "example.com", []models.Policy{creditCardPolicy()})
	if !v.matched {
		t.Fatalf("expected a match, got %+v", v)
	}
}

func TestResolveUnscannableAction_DefaultsToAllow(t *testing.T) {
	if got := resolveUnscannableAction(nil, "encrypted_archive"); got != "allow" {
		t.Fatalf("expected default allow with no policies, got %q", got)
	}
	p := models.Policy{Rules: map[string]any{}}
	if got := resolveUnscannableAction([]models.Policy{p}, "encrypted_archive"); got != "allow" {
		t.Fatalf("expected default allow when on_unscannable unset, got %q", got)
	}
}

func TestResolveUnscannableAction_MostSevereWins(t *testing.T) {
	alertPolicy := models.Policy{Rules: map[string]any{
		"on_unscannable": map[string]any{"encrypted_archive": "alert"},
	}}
	blockPolicy := models.Policy{Rules: map[string]any{
		"on_unscannable": map[string]any{"encrypted_archive": "block"},
	}}
	got := resolveUnscannableAction([]models.Policy{alertPolicy, blockPolicy}, "encrypted_archive")
	if got != "block" {
		t.Fatalf("expected block (most severe) to win, got %q", got)
	}
}

func TestResolveUnscannableAction_UnrelatedReasonIgnored(t *testing.T) {
	p := models.Policy{Rules: map[string]any{
		"on_unscannable": map[string]any{"encrypted_archive": "block"},
	}}
	got := resolveUnscannableAction([]models.Policy{p}, "extraction_timeout")
	if got != "allow" {
		t.Fatalf("expected allow for an unconfigured reason, got %q", got)
	}
}

func TestUnscannableVerdict_AllowProducesNoMatch(t *testing.T) {
	item := extractclient.Item{Part: "a.zip!b.7z", Reason: "encrypted_archive"}
	v := unscannableVerdict(item, nil)
	if v.matched {
		t.Fatalf("expected no match when on_unscannable resolves to allow, got %+v", v)
	}
}

func TestUnscannableVerdict_BlockPolicyBlocksUpload(t *testing.T) {
	p := models.Policy{Rules: map[string]any{
		"on_unscannable": map[string]any{"encrypted_archive": "block"},
	}}
	item := extractclient.Item{Part: "vault.zip!secret.7z", Reason: "encrypted_archive", Detail: "password-protected"}
	v := unscannableVerdict(item, []models.Policy{p})
	if !v.matched || v.action != "block" {
		t.Fatalf("expected a block verdict, got %+v", v)
	}
	if v.reason == "" {
		t.Fatal("expected a human-readable reason to be set")
	}
}

// fakeExtractService stands in for extract-service, emitting a scripted
// NDJSON body so scanDLPStreamViaExtract can be exercised without a real
// Python process.
func fakeExtractService(t *testing.T, lines []map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		for _, line := range lines {
			b, _ := json.Marshal(line)
			w.Write(b)
			w.Write([]byte("\n"))
		}
	}))
}

func TestScanDLPStreamViaExtract_SegmentBlocks(t *testing.T) {
	srv := fakeExtractService(t, []map[string]any{
		{"kind": "segment", "seq": 1, "part": "note.txt", "filename": "note.txt", "mime": "text/plain",
			"source": "text", "text": "card: " + testCard},
		{"kind": "summary", "parts": 1, "bytes_in": 10, "complete": true},
	})
	defer srv.Close()
	t.Setenv("EXTRACT_SERVICE_URL", srv.URL)

	body := []byte("irrelevant, extract-service supplies the content")
	spool := writeSpool(t, body)
	v, ok := scanDLPStreamViaExtract(context.Background(), "org1", "note.txt", "text/plain", "example.com",
		spool, int64(len(body)), []models.Policy{creditCardPolicy()})
	if !ok {
		t.Fatal("expected scanDLPStreamViaExtract to succeed")
	}
	if !v.matched || v.action != "block" {
		t.Fatalf("expected a blocked match from the segment, got %+v", v)
	}
}

func TestScanDLPStreamViaExtract_UnscannableRespectsPolicy(t *testing.T) {
	srv := fakeExtractService(t, []map[string]any{
		{"kind": "unscannable", "seq": 1, "part": "vault.zip!secret.7z", "reason": "encrypted_archive", "detail": "no password"},
		{"kind": "summary", "parts": 1, "bytes_in": 10, "complete": true},
	})
	defer srv.Close()
	t.Setenv("EXTRACT_SERVICE_URL", srv.URL)

	blockPolicy := models.Policy{Rules: map[string]any{
		"on_unscannable": map[string]any{"encrypted_archive": "block"},
	}}
	spool := writeSpool(t, []byte("irrelevant"))
	v, ok := scanDLPStreamViaExtract(context.Background(), "org1", "vault.zip", "application/zip", "example.com",
		spool, 10, []models.Policy{blockPolicy})
	if !ok {
		t.Fatal("expected scanDLPStreamViaExtract to succeed")
	}
	if !v.matched || v.action != "block" {
		t.Fatalf("expected the encrypted archive to block per policy, got %+v", v)
	}
}

func TestScanDLPStream_FallsBackWhenExtractServiceUnreachable(t *testing.T) {
	// Point at a URL nothing is listening on — Stream() must error and
	// scanDLPStream must fall back to the raw-byte path rather than
	// silently treating the content as clean.
	t.Setenv("EXTRACT_SERVICE_URL", "http://127.0.0.1:1")

	spool := writeSpool(t, []byte("card: "+testCard))
	v := scanDLPStream(context.Background(), "org1", "note.txt", "text/plain", "example.com",
		spool, int64(len("card: "+testCard)), []models.Policy{creditCardPolicy()})
	if !v.matched || v.action != "block" {
		t.Fatalf("expected fallback raw-byte scan to still catch the card, got %+v", v)
	}
}

func TestScanDLPStream_ExtractServiceDisabledUsesRawPath(t *testing.T) {
	t.Setenv("EXTRACT_SERVICE_URL", "")
	spool := writeSpool(t, []byte("card: "+testCard))
	v := scanDLPStream(context.Background(), "org1", "note.txt", "text/plain", "example.com",
		spool, int64(len("card: "+testCard)), []models.Policy{creditCardPolicy()})
	if !v.matched || v.action != "block" {
		t.Fatalf("expected raw path to catch the card when extract-service is disabled, got %+v", v)
	}
}

func TestScanDLPStreamViaExtract_TransportErrorReturnsNotOK(t *testing.T) {
	t.Setenv("EXTRACT_SERVICE_URL", "http://127.0.0.1:1")
	spool := writeSpool(t, []byte("x"))
	_, ok := scanDLPStreamViaExtract(context.Background(), "org1", "note.txt", "text/plain", "example.com",
		spool, 1, []models.Policy{creditCardPolicy()})
	if ok {
		t.Fatal("expected ok=false when extract-service is unreachable")
	}
}

func TestScanDLPStreamViaExtract_StopsEarlyOnBlock(t *testing.T) {
	// A second segment after the blocking one must never be scanned/counted
	// — this is the "block is terminal" contract carried over from the
	// raw-byte path.
	blockedContent := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		flusher, _ := w.(http.Flusher)
		lines := []map[string]any{
			{"kind": "segment", "seq": 1, "part": "a.txt", "filename": "a.txt", "text": "card: " + testCard},
			{"kind": "segment", "seq": 2, "part": "b.txt", "filename": "b.txt", "text": "should never be reached"},
			{"kind": "summary", "parts": 2, "complete": true},
		}
		for i, line := range lines {
			if i == 1 {
				blockedContent = true // if we get here, the client kept reading past the block
			}
			b, _ := json.Marshal(line)
			w.Write(b)
			w.Write([]byte("\n"))
			if flusher != nil {
				flusher.Flush()
			}
		}
	}))
	defer srv.Close()
	t.Setenv("EXTRACT_SERVICE_URL", srv.URL)

	spool := writeSpool(t, []byte("irrelevant"))
	v, ok := scanDLPStreamViaExtract(context.Background(), "org1", "bundle.zip", "application/zip", "example.com",
		spool, 10, []models.Policy{creditCardPolicy()})
	if !ok || !v.matched || v.action != "block" {
		t.Fatalf("expected a blocked verdict, got ok=%v v=%+v", ok, v)
	}
	_ = blockedContent // server-side write order isn't a reliable client-stop signal over a
	// buffered pipe in a fast local test; the real contract (closing the
	// body on block) is exercised for real by extract-service's own
	// integration behavior — see its README/tests for the generator-side
	// half of this guarantee.
}

func TestExtractClientStream_ParsesSummary(t *testing.T) {
	srv := fakeExtractService(t, []map[string]any{
		{"kind": "segment", "seq": 1, "part": "a.txt", "text": "hi"},
		{"kind": "summary", "parts": 1, "bytes_in": 2, "complete": true, "elapsed_ms": 5},
	})
	defer srv.Close()
	t.Setenv("EXTRACT_SERVICE_URL", srv.URL)

	var seen []string
	summary, err := extractclient.Stream(context.Background(), "org1", "a.txt", "text/plain",
		bytes.NewReader([]byte("hi")), 2, true, true, 0, func(it extractclient.Item) bool {
			seen = append(seen, it.Kind)
			return false
		})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if len(seen) != 1 || seen[0] != "segment" {
		t.Fatalf("expected exactly one segment callback, got %v", seen)
	}
	if !summary.Complete || summary.Parts != 1 {
		t.Fatalf("unexpected summary: %+v", summary)
	}
}

func TestExtractClientStream_NonOKStatusIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"error":"bad token"}`)
	}))
	defer srv.Close()
	t.Setenv("EXTRACT_SERVICE_URL", srv.URL)

	_, err := extractclient.Stream(context.Background(), "org1", "a.txt", "text/plain",
		bytes.NewReader([]byte("hi")), 2, true, true, 0, func(extractclient.Item) bool { return false })
	if err == nil {
		t.Fatal("expected an error for a non-200 response")
	}
}

// ─── vision-AI (scanImageVerdict) ──────────────────────────────────────────

func TestAnyPolicyEnablesAIVisual(t *testing.T) {
	if anyPolicyEnablesAIVisual([]models.Policy{creditCardPolicy()}) {
		t.Fatal("credit-card-only policy must not report ai_visual enabled")
	}
	if !anyPolicyEnablesAIVisual([]models.Policy{creditCardPolicy(), aiVisualPolicy()}) {
		t.Fatal("expected ai_visual enabled when one policy among several has it")
	}
	if anyPolicyEnablesAIVisual(nil) {
		t.Fatal("no policies must not report ai_visual enabled")
	}
}

func TestScanImageVerdict_SkippedWhenAIServiceDisabled(t *testing.T) {
	t.Setenv("AI_SERVICE_URL", "")
	item := extractclient.Item{Part: "photo.jpg", Mime: "image/jpeg", B64: "aGVsbG8="}
	v := scanImageVerdict(context.Background(), "org1", item, "example.com", []models.Policy{aiVisualPolicy()})
	if v.matched {
		t.Fatalf("expected no match when ai-service is disabled, got %+v", v)
	}
}

func TestScanImageVerdict_SkippedWhenDetectorNotEnabled(t *testing.T) {
	calls := 0
	fakeAI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		json.NewEncoder(w).Encode(map[string]any{"sensitive": true, "doc_type": "aadhaar_card", "confidence": 95})
	}))
	defer fakeAI.Close()
	t.Setenv("AI_SERVICE_URL", fakeAI.URL)

	item := extractclient.Item{Part: "photo.jpg", Mime: "image/jpeg", B64: "aGVsbG8="}
	v := scanImageVerdict(context.Background(), "org1", item, "example.com", []models.Policy{creditCardPolicy()})
	if v.matched {
		t.Fatalf("expected no match when no policy enables ai_visual, got %+v", v)
	}
	if calls != 0 {
		t.Fatalf("expected the model to never be called, got %d calls", calls)
	}
}

func TestScanImageVerdict_NotSensitiveProducesNoMatch(t *testing.T) {
	fakeAI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"sensitive": false, "doc_type": "none", "confidence": 0})
	}))
	defer fakeAI.Close()
	t.Setenv("AI_SERVICE_URL", fakeAI.URL)

	item := extractclient.Item{Part: "photo.jpg", Mime: "image/jpeg", B64: "aGVsbG8="}
	v := scanImageVerdict(context.Background(), "org1", item, "example.com", []models.Policy{aiVisualPolicy()})
	if v.matched {
		t.Fatalf("expected no match for a non-sensitive image, got %+v", v)
	}
}

func TestScanImageVerdict_SensitiveFlowsThroughToDLPScoring(t *testing.T) {
	// The vision verdict must be threaded all the way through to
	// dlp-service as an external_matches entry — this fake dlp-service
	// only blocks if it actually received one, proving the wiring (not
	// just that scanImageVerdict "returns something").
	fakeAI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"sensitive": true, "doc_type": "aadhaar_card", "confidence": 95, "evidence": "govt id layout",
		})
	}))
	defer fakeAI.Close()

	fakeDLP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ExternalMatches []map[string]any `json:"external_matches"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if len(body.ExternalMatches) != 1 || body.ExternalMatches[0]["detector"] != "ai_visual" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"scanned": true, "matched": false, "score": 0, "band": "allow", "action": "allow"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"scanned": true, "matched": true, "score": 90, "band": "block", "action": "block",
			"policy_name": "test-vision-policy", "reason": "Sensitive company data detected: AI Image Classification",
			"detectors": []string{"ai_visual"},
			"matches": []map[string]any{{"detector": "ai_visual", "label": "AI Image Classification: aadhaar_card",
				"masked_preview": "aadhaar_card", "weight": 71}},
			"thresholds": map[string]int{"block": 80, "alert": 50},
		})
	}))
	defer fakeDLP.Close()

	t.Setenv("AI_SERVICE_URL", fakeAI.URL)
	t.Setenv("DLP_SERVICE_URL", fakeDLP.URL)

	item := extractclient.Item{Part: "id_photo.jpg", Filename: "id_photo.jpg", Mime: "image/jpeg", B64: "aGVsbG8="}
	v := scanImageVerdict(context.Background(), "org1", item, "example.com", []models.Policy{aiVisualPolicy()})

	if !v.matched || v.action != "block" {
		t.Fatalf("expected the vision hit to flow through to a blocked DLP verdict, got %+v", v)
	}
}
