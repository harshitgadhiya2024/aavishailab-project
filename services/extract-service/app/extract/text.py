"""Plain text, CSV/TSV, JSON, XML/HTML, and form-encoded bodies — the
formats chat apps and simple uploads actually use. Each yields Segment
items only (no images, no recursion), so these are the cheapest, safest
extractors and also the ones on the hot path for "just scan this chat
message" traffic.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Iterable
from urllib.parse import parse_qsl

from defusedxml import ElementTree as SafeET

from .base import ExtractContext, Item, Segment
from ..charset import decode_best_effort


def extract_text(stream, part: str, filename: str, mime: str, ctx: ExtractContext) -> Iterable[Item]:
    raw = stream.read()
    ctx.check_budget(len(raw))
    yield Segment(part=part, filename=filename, mime=mime or "text/plain",
                  source="text", text=decode_best_effort(raw))


def extract_csv(stream, part: str, filename: str, mime: str, ctx: ExtractContext) -> Iterable[Item]:
    raw = stream.read()
    ctx.check_budget(len(raw))
    text = decode_best_effort(raw)
    # Re-emit as text: detectors are line/regex based and a CSV's cells read
    # fine as plain text; the csv module is used only to validate structure
    # isn't hopelessly broken, not to reshape the content.
    try:
        list(csv.reader(io.StringIO(text[:65536])))
    except csv.Error:
        pass
    yield Segment(part=part, filename=filename, mime=mime or "text/csv", source="csv", text=text)


def extract_json(stream, part: str, filename: str, mime: str, ctx: ExtractContext) -> Iterable[Item]:
    """Streams every string value out of a JSON (or NDJSON) body as its own
    segment. This is what makes a chat message or API payload — a Slack
    message, a Teams post, a JSON form body — scannable: the raw bytes of a
    JSON document are usually escaped enough (\\n, \\", unicode escapes)
    that a naive byte-level regex scan of the whole blob misses values a
    parsed-and-decoded string would catch cleanly."""
    raw = stream.read()
    ctx.check_budget(len(raw))
    text = decode_best_effort(raw)

    strings: list[str] = []

    def walk(obj):
        if isinstance(obj, str):
            strings.append(obj)
        elif isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(k, str):
                    strings.append(k)
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)

    parsed_any = False
    for line in text.splitlines() or [text]:
        line = line.strip()
        if not line:
            continue
        try:
            walk(json.loads(line))
            parsed_any = True
        except (json.JSONDecodeError, ValueError):
            continue

    if not parsed_any:
        try:
            walk(json.loads(text))
            parsed_any = True
        except (json.JSONDecodeError, ValueError):
            pass

    if parsed_any and strings:
        yield Segment(part=part, filename=filename, mime=mime or "application/json",
                      source="json", text="\n".join(strings))
    else:
        # Malformed JSON is still worth scanning as raw text — a truncated
        # or hand-edited body shouldn't become an inspection blind spot.
        yield Segment(part=part, filename=filename, mime=mime or "application/json",
                      source="json_raw", text=text)


def extract_urlencoded(stream, part: str, filename: str, mime: str, ctx: ExtractContext) -> Iterable[Item]:
    raw = stream.read()
    ctx.check_budget(len(raw))
    text = decode_best_effort(raw)
    pairs = parse_qsl(text, keep_blank_values=True, errors="replace")
    values = "\n".join(f"{k}={v}" for k, v in pairs) if pairs else text
    yield Segment(part=part, filename=filename, mime="application/x-www-form-urlencoded",
                  source="urlencoded", text=values)


def extract_xml_or_html(stream, part: str, filename: str, mime: str, ctx: ExtractContext) -> Iterable[Item]:
    raw = stream.read()
    ctx.check_budget(len(raw))
    text = decode_best_effort(raw)

    texts: list[str] = []
    try:
        root = SafeET.fromstring(raw)
        for elem in root.iter():
            if elem.text and elem.text.strip():
                texts.append(elem.text.strip())
            for k, v in (elem.attrib or {}).items():
                if v and v.strip():
                    texts.append(v.strip())
        body = "\n".join(texts) if texts else text
    except Exception:
        # Not well-formed XML (very common for real-world HTML) — fall back
        # to a crude tag-stripper rather than dropping the content.
        body = _strip_tags(text)

    yield Segment(part=part, filename=filename, mime=mime or "text/html", source="xml", text=body)


def _strip_tags(text: str) -> str:
    out = []
    in_tag = False
    for ch in text:
        if ch == "<":
            in_tag = True
        elif ch == ">":
            in_tag = False
        elif not in_tag:
            out.append(ch)
    return "".join(out)
