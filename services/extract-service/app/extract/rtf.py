"""RTF — a thin wrapper around striprtf, which turns RTF control-word
markup into plain text."""

from __future__ import annotations

from typing import Iterable

from striprtf.striprtf import rtf_to_text

from .base import ExtractContext, Item, Segment, Unscannable
from ..charset import decode_best_effort


def extract(stream, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    raw = stream.read()
    ctx.check_budget(len(raw))
    try:
        text = rtf_to_text(decode_best_effort(raw))
    except Exception as exc:
        yield Unscannable(part=part, reason="corrupt", detail=str(exc))
        return
    yield Segment(part=part, filename=filename, mime="application/rtf", source="rtf", text=text)
