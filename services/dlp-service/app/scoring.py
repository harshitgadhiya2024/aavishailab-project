"""Weighted DLP scoring + decision banding.

This is the core of the feature. Detector hits are aggregated into a single
0-100 sensitivity score; the score maps to a band (block / alert / allow) via
per-org thresholds (defaults 80 / 50); and the band is combined with the
policy's own action so that, e.g., an *alert-only* policy never blocks even on
a score of 95.

Aggregation is deliberately non-linear: the strongest signal counts fully and
each additional hit contributes at a discount, so a bulk leak (many cards)
scores higher than a single one without any single detector being able to
trivially max the score alone.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import detectors as d
from .config import settings

# Extra points when a structured identifier/credential co-occurs with a
# sensitive keyword — "account number: ... salary" is more clearly a real leak
# than either signal alone.
_CONTEXT_BONUS = 10

# Fraction each non-dominant match contributes to the aggregate score.
_SECONDARY_WEIGHT = 0.4

_BAND_SEVERITY = {"block": 3, "alert": 2, "allow": 0}
_ACTION_SEVERITY = {"block": 3, "alert": 2, "log": 1, "allow": 0}
_SEVERITY_ACTION = {3: "block", 2: "alert", 1: "log", 0: "allow"}


@dataclass
class Policy:
    name: str = ""
    action: str = "block"  # block | alert | log | allow (the policy's ceiling)
    detectors: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    custom_patterns: list[d.CustomPattern] = field(default_factory=list)
    bypass_file_types: list[str] = field(default_factory=list)
    detector_weights: dict[str, int] = field(default_factory=dict)
    block_threshold: int | None = None
    alert_threshold: int | None = None
    priority: int = 100

    def weight_for(self, detector: str) -> int:
        return int(self.detector_weights.get(detector, d.DEFAULT_WEIGHTS.get(detector, 25)))

    def thresholds(self) -> tuple[int, int]:
        block = self.block_threshold if self.block_threshold is not None else settings.default_block_threshold
        alert = self.alert_threshold if self.alert_threshold is not None else settings.default_alert_threshold
        # Guard against a mis-configured policy where alert >= block.
        if alert >= block:
            alert = max(0, block - 1)
        return block, alert


@dataclass
class PolicyResult:
    matched: bool
    score: int
    band: str
    action: str
    policy_name: str
    matches: list[d.Match]
    block_threshold: int
    alert_threshold: int


def band_for(score: int, block_t: int, alert_t: int) -> str:
    if score >= block_t:
        return "block"
    if score >= alert_t:
        return "alert"
    return "allow"


def aggregate(weights: list[int], context_combo: bool) -> int:
    if not weights:
        return 0
    ordered = sorted(weights, reverse=True)
    score = ordered[0] + _SECONDARY_WEIGHT * sum(ordered[1:])
    if context_combo:
        score += _CONTEXT_BONUS
    return min(100, int(round(score)))


def _effective_action(band: str, policy_action: str) -> str:
    band_sev = _BAND_SEVERITY.get(band, 0)
    policy_sev = _ACTION_SEVERITY.get(policy_action, 3)
    return _SEVERITY_ACTION[min(band_sev, policy_sev)]


def _run_detectors(policy: Policy, text: str, filename: str) -> list[d.Match]:
    matches: list[d.Match] = []
    for det in policy.detectors:
        w = policy.weight_for(det)
        if det == d.CREDIT_CARD:
            matches += d.detect_credit_card(text, w)
        elif det == d.PAN_INDIA:
            matches += d.detect_pan(text, w)
        elif det == d.AADHAAR:
            matches += d.detect_aadhaar(text, w)
        elif det == d.AWS_KEY:
            matches += d.detect_aws_key(text, w)
        elif det == d.GITHUB_TOKEN:
            matches += d.detect_github_token(text, w)
        elif det == d.GENERIC_API_KEY:
            matches += d.detect_generic_api_key(text, w)
        elif det == d.SOURCE_CODE:
            matches += d.detect_source_code(filename, w)
    matches += d.detect_keywords(text, policy.keywords, policy.weight_for(d.KEYWORD))
    matches += d.detect_custom_patterns(text, policy.custom_patterns, policy.weight_for(d.CUSTOM_REGEX))
    return matches


def score_policy(policy: Policy, text: str, filename: str, content_type: str) -> PolicyResult:
    block_t, alert_t = policy.thresholds()

    category = d.file_category(filename, content_type)
    if category in {ft.lower() for ft in policy.bypass_file_types}:
        # Whole file-type exempted from THIS policy.
        return PolicyResult(False, 0, "allow", "allow", policy.name, [], block_t, alert_t)

    matches = _run_detectors(policy, text, filename)
    if not matches:
        return PolicyResult(False, 0, "allow", "allow", policy.name, [], block_t, alert_t)

    detector_kinds = {m.detector for m in matches}
    has_structured = bool(detector_kinds & d.STRUCTURED_DETECTORS)
    has_keyword = d.KEYWORD in detector_kinds or d.CUSTOM_REGEX in detector_kinds
    context_combo = has_structured and has_keyword

    score = aggregate([m.weight for m in matches], context_combo)
    band = band_for(score, block_t, alert_t)
    action = _effective_action(band, policy.action)

    return PolicyResult(
        matched=True,
        score=score,
        band=band,
        action=action,
        policy_name=policy.name,
        matches=matches,
        block_threshold=block_t,
        alert_threshold=alert_t,
    )


def scan(policies: list[Policy], text: str, filename: str, content_type: str) -> PolicyResult:
    """Evaluate content against all enabled DLP policies and return the single
    most-severe outcome (block beats alert beats log beats allow; ties break on
    higher score, then lower priority number = higher precedence).

    Unlike naive first-match, this guarantees that if ANY policy would block,
    the upload is blocked — a stricter, safer default for data loss.
    """
    best: PolicyResult | None = None
    best_key: tuple[int, int, int] | None = None

    for policy in policies:
        result = score_policy(policy, text, filename, content_type)
        if not result.matched:
            continue
        # Higher action severity wins; then higher score; then lower priority
        # number (negated so "smaller priority = stronger" sorts as larger).
        key = (_ACTION_SEVERITY.get(result.action, 0), result.score, -policy.priority)
        if best_key is None or key > best_key:
            best, best_key = result, key

    if best is None:
        block_t = settings.default_block_threshold
        alert_t = settings.default_alert_threshold
        return PolicyResult(False, 0, "allow", "allow", "", [], block_t, alert_t)
    return best
