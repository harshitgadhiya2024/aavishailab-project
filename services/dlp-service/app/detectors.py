"""Sensitive-data detectors — ported faithfully from the Go `internal/dlp`
package, with a per-match `weight`/`confidence` added so the scoring engine
(scoring.py) can produce a real 0-100 sensitivity score instead of a bare
match count.

Honest limitation (unchanged from the Go original): these are
pattern/checksum detectors, not ML classifiers. They catch well-formed
identifiers and configured keywords; they will miss sensitive data that
doesn't match a known shape and can false-positive on coincidental strings.
Checksums (Luhn for cards, Verhoeff for Aadhaar) are what keep confidence —
and therefore score — honest.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Iterable

# ─── Detector identifiers ──────────────────────────────────────────────────────

CREDIT_CARD = "credit_card"
PAN_INDIA = "pan_india"
AADHAAR = "aadhaar"
AWS_KEY = "aws_key"
GITHUB_TOKEN = "github_token"
GENERIC_API_KEY = "generic_api_key"
SOURCE_CODE = "source_code"
KEYWORD = "keyword"
CUSTOM_REGEX = "custom_regex"

BUILTIN_LABELS = {
    CREDIT_CARD: "Credit Card Number",
    PAN_INDIA: "PAN Card (India)",
    AADHAAR: "Aadhaar Number (India)",
    AWS_KEY: "AWS Access Key",
    GITHUB_TOKEN: "GitHub Token",
    GENERIC_API_KEY: "Generic API Key / Secret",
    SOURCE_CODE: "Source Code File",
}

# Structured identifiers/credentials (as opposed to keyword/custom hits) — used
# by scoring.py to award a context bonus when a structured hit co-occurs with a
# sensitive keyword ("salary", "confidential", ...).
STRUCTURED_DETECTORS = frozenset(
    {CREDIT_CARD, PAN_INDIA, AADHAAR, AWS_KEY, GITHUB_TOKEN, GENERIC_API_KEY}
)

# Default per-detector weights (0-100). Calibrated so that:
#   • a single leaked cloud credential lands in the BLOCK band on its own,
#   • a single valid card/Aadhaar lands in the ALERT band,
#   • format-only signals (PAN, keywords) sit lower to limit false positives,
#   • and multiple hits aggregate upward (see scoring.aggregate).
# A policy may override any of these via `detector_weights`.
DEFAULT_WEIGHTS = {
    AWS_KEY: 85,
    GITHUB_TOKEN: 80,
    GENERIC_API_KEY: 70,
    CREDIT_CARD: 55,
    AADHAAR: 55,
    PAN_INDIA: 45,
    SOURCE_CODE: 40,
    CUSTOM_REGEX: 35,
    KEYWORD: 25,
}


@dataclass
class Match:
    detector: str
    label: str
    preview: str  # redacted — never the full sensitive value
    weight: int

    def as_dict(self) -> dict:
        return {
            "detector": self.detector,
            "label": self.label,
            "masked_preview": self.preview,
            "weight": self.weight,
        }


@dataclass
class CustomPattern:
    name: str
    regex: str


# ─── Compiled patterns ─────────────────────────────────────────────────────────

_CREDIT_CARD_CANDIDATE = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_PAN = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")
_AADHAAR = re.compile(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}\b")
_AWS_KEY = re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")
_GITHUB_TOKEN = re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b")
_GENERIC_API_KEY = re.compile(
    r"(?i)(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|"
    r"client[_-]?secret|private[_-]?key|password)\s*[:=]\s*"
    r"['\"]?([A-Za-z0-9_\-/+]{12,})['\"]?"
)

_SOURCE_CODE_EXTS = (
    ".go", ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h",
    ".hpp", ".cs", ".rb", ".php", ".rs", ".swift", ".kt", ".scala", ".sql",
    ".sh", ".pl",
)

# Entropy floor below which an AWS-shaped / generic secret is treated as too
# low-randomness to be a real key — cuts placeholders like "AKIAEXAMPLE...".
_MIN_SECRET_ENTROPY = 3.0


# ─── Redaction ─────────────────────────────────────────────────────────────────

def redact_digits(digits: str) -> str:
    if len(digits) <= 4:
        return "****"
    return "*" * (len(digits) - 4) + digits[-4:]


def redact_alnum(s: str) -> str:
    keep = 4
    if len(s) <= keep:
        return "****"
    return s[:keep] + "****"


# ─── Checksums ─────────────────────────────────────────────────────────────────

def _strip_separators(s: str) -> str:
    return "".join(ch for ch in s if ch.isdigit())


def luhn_valid(digits: str) -> bool:
    total = 0
    alt = False
    for ch in reversed(digits):
        if not ch.isdigit():
            return False
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


_VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def verhoeff_valid(digits: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(digits)):
        if not ch.isdigit():
            return False
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    counts: dict[str, int] = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


# ─── Detectors ─────────────────────────────────────────────────────────────────

def detect_credit_card(text: str, weight: int) -> list[Match]:
    out: list[Match] = []
    for raw in _CREDIT_CARD_CANDIDATE.findall(text):
        digits = _strip_separators(raw)
        if not (13 <= len(digits) <= 19):
            continue
        if not luhn_valid(digits):
            continue
        out.append(Match(CREDIT_CARD, BUILTIN_LABELS[CREDIT_CARD], redact_digits(digits), weight))
    return out


def detect_pan(text: str, weight: int) -> list[Match]:
    return [
        Match(PAN_INDIA, BUILTIN_LABELS[PAN_INDIA], redact_alnum(raw), weight)
        for raw in _PAN.findall(text.upper())
    ]


def detect_aadhaar(text: str, weight: int) -> list[Match]:
    out: list[Match] = []
    for raw in _AADHAAR.findall(text):
        digits = _strip_separators(raw)
        if len(digits) != 12 or not verhoeff_valid(digits):
            continue
        out.append(Match(AADHAAR, BUILTIN_LABELS[AADHAAR], redact_digits(digits), weight))
    return out


def detect_aws_key(text: str, weight: int) -> list[Match]:
    out: list[Match] = []
    for m in _AWS_KEY.finditer(text):
        token = m.group(0)
        if shannon_entropy(token[4:]) < _MIN_SECRET_ENTROPY:
            continue
        out.append(Match(AWS_KEY, BUILTIN_LABELS[AWS_KEY], redact_alnum(token), weight))
    return out


def detect_github_token(text: str, weight: int) -> list[Match]:
    return [
        Match(GITHUB_TOKEN, BUILTIN_LABELS[GITHUB_TOKEN], redact_alnum(raw), weight)
        for raw in _GITHUB_TOKEN.findall(text)
    ]


def detect_generic_api_key(text: str, weight: int) -> list[Match]:
    out: list[Match] = []
    for m in _GENERIC_API_KEY.finditer(text):
        key_name, value = m.group(1), m.group(2)
        if shannon_entropy(value) < _MIN_SECRET_ENTROPY:
            continue
        out.append(
            Match(
                GENERIC_API_KEY,
                BUILTIN_LABELS[GENERIC_API_KEY],
                f"{key_name}={redact_alnum(value)}",
                weight,
            )
        )
    return out


def detect_source_code(filename: str, weight: int) -> list[Match]:
    lower = (filename or "").lower()
    for ext in _SOURCE_CODE_EXTS:
        if lower.endswith(ext):
            return [Match(SOURCE_CODE, BUILTIN_LABELS[SOURCE_CODE], filename, weight)]
    return []


def detect_keywords(text: str, keywords: Iterable[str], weight: int) -> list[Match]:
    out: list[Match] = []
    lower = text.lower()
    for kw in keywords:
        kw = (kw or "").strip()
        if kw and kw.lower() in lower:
            out.append(Match(KEYWORD, f"Keyword: {kw}", kw, weight))
    return out


def detect_custom_patterns(text: str, patterns: Iterable[CustomPattern], weight: int) -> list[Match]:
    out: list[Match] = []
    for p in patterns:
        try:
            re_c = re.compile(p.regex)
        except re.error:
            # A typo'd custom pattern must not take down the whole scan.
            continue
        if re_c.search(text):
            out.append(Match(CUSTOM_REGEX, f"Custom: {p.name}", p.name, weight))
    return out


# ─── File-type bucketing (for policy bypass lists) ─────────────────────────────

def file_category(filename: str, content_type: str) -> str:
    ct = (content_type or "").lower()
    name = (filename or "").lower()
    if ct.startswith("image/") or name.endswith(
        (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")
    ):
        return "image"
    if ct == "application/pdf" or name.endswith(".pdf"):
        return "pdf"
    if "zip" in ct or "compressed" in ct or name.endswith((".zip", ".rar", ".7z")):
        return "archive"
    return "document"
