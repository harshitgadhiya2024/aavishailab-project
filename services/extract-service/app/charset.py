"""Best-effort text decoding for content whose encoding isn't declared.
Detectors are ASCII-oriented (card numbers, PAN, keywords), so getting the
encoding exactly right matters less than never raising on binary-ish input —
this always returns a str, never throws."""

from __future__ import annotations

from charset_normalizer import from_bytes


def decode_best_effort(raw: bytes) -> str:
    if not raw:
        return ""
    try:
        raw.decode("utf-8")
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        pass
    try:
        best = from_bytes(raw).best()
        if best is not None:
            return str(best)
    except Exception:
        pass
    return raw.decode("utf-8", errors="replace")
