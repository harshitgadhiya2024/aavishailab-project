package handlers

import (
	"testing"

	"github.com/aavishield/admin-api/internal/models"
)

// This pins the bug found by live-testing DLP against every upload format:
// an org running purely on the automatic/default DLP policy (no custom
// policy authored — the common, "zero setup" case the default exists for)
// had its audio and image uploads silently never scanned by the AI tiers,
// while plain-text/PDF/DOCX uploads were caught fine via the regex/checksum
// detectors. Confirmed live: a .docx and a spoken .wav, both containing the
// same GitHub token, submitted through the same production endpoint — the
// .docx was caught, the .wav was not.
//
// Root cause: scanDLPMediaVerdict, scanImageVerdict and
// classifyTextSegment each gate their own ai-service call on
// anyPolicyEnablesDetector(policies, "ai_audio"/"ai_visual"/"ai_text")
// before scanDLPContentExt ever got a chance to inject the default policy
// (which turns all three on) — so an org with an empty custom-policy list
// always failed that check and those three tiers never fired, regardless
// of content. Fixed by computing the effective policy list once, in
// ScanDLP, before anything gates on it.

func TestEffectiveDLPPolicies_EmptyListGetsTheAutomaticDefault(t *testing.T) {
	effective := effectiveDLPPolicies(nil)
	if len(effective) != 1 {
		t.Fatalf("expected exactly the one default policy, got %d", len(effective))
	}
	if effective[0].Name != DefaultDLPPolicyName {
		t.Fatalf("expected the automatic default policy, got %q", effective[0].Name)
	}
}

func TestEffectiveDLPPolicies_DefaultEnablesAllThreeAITiers(t *testing.T) {
	// The exact assertion the live bug violated: with no custom policy, an
	// org must still get ai_text, ai_visual AND ai_audio — that is the
	// entire point of "automatic" DLP. Checked via the same
	// anyPolicyEnablesDetector helper the real gates call, not by reading
	// the Rules map directly, so this fails the same way the real bug did
	// if either regresses.
	effective := effectiveDLPPolicies(nil)
	for _, tier := range []string{"ai_text", "ai_visual", "ai_audio"} {
		if !anyPolicyEnablesDetector(effective, tier) {
			t.Errorf("automatic default policy does not enable %q — audio/image/semantic-text DLP would silently never fire for an org with no custom DLP policy", tier)
		}
	}
}

func TestEffectiveDLPPolicies_NonEmptyListPassesThrough(t *testing.T) {
	custom := []models.Policy{{Name: "Org's own DLP policy"}}
	effective := effectiveDLPPolicies(custom)
	if len(effective) != 1 || effective[0].Name != "Org's own DLP policy" {
		t.Fatalf("a non-empty policy list must not be replaced by the default, got %+v", effective)
	}
}
