"""Legacy OLE/CFB-format documents: .doc, .xls, .ppt, .msg — and encrypted
OOXML files, which are actually OLE containers wrapping an encrypted zip
(they sniff as "ole", never "zip", which is how they end up here instead of
in ooxml.py).

Deliberately no dependency on `extract-msg` (GPL) or a full legacy binary
document-format parser. Outlook .msg bodies are read from their well-known
named property streams; everything else (.doc/.xls/.ppt) gets best-effort
text-run extraction — every OLE stream is scanned for runs of printable
ASCII or UTF-16LE text above a length threshold. That is not full
document-model fidelity, but it reliably surfaces free text — exactly what
DLP detectors need — without a heavyweight or copyleft-licensed parser.
"""

from __future__ import annotations

import re
from typing import Iterable

import olefile

from .base import ExtractContext, Item, Segment, Unscannable

_MIN_RUN = 4
_ASCII_RUN = re.compile(rb"[\x20-\x7e]{%d,}" % _MIN_RUN)
_UTF16_RUN = re.compile(rb"(?:[\x20-\x7e]\x00){%d,}" % _MIN_RUN)

_ENCRYPTION_STREAMS = {"EncryptionInfo", "EncryptedPackage"}
_MSG_UNICODE_BODY = "__substg1.0_1000001F"
_MSG_ASCII_BODY = "__substg1.0_1000001E"


def extract(stream, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    try:
        ole = olefile.OleFileIO(stream)
    except OSError as exc:
        yield Unscannable(part=part, reason="corrupt", detail=str(exc))
        return

    try:
        streams = ["/".join(p) for p in ole.listdir()]
        if any(s in _ENCRYPTION_STREAMS for s in streams):
            yield Unscannable(part=part, reason="encrypted_document",
                               detail="OLE-wrapped encrypted Office package")
            return

        if any(s.startswith("__substg1.0_") for s in streams):
            yield from _extract_msg(ole, streams, part, filename, ctx)
        else:
            yield from _extract_generic(ole, streams, part, filename, ctx)
    finally:
        ole.close()


def _read(ole, name: str, ctx: ExtractContext) -> bytes:
    data = ole.openstream(name).read()
    ctx.check_budget(len(data))
    return data


def _decode_stream(name: str, data: bytes) -> str:
    if name.endswith("001F"):  # PT_UNICODE property (UTF-16LE)
        return data.decode("utf-16-le", errors="replace")
    return data.decode("utf-8", errors="replace")


def _extract_msg(ole, streams, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    texts = []
    for name in (_MSG_UNICODE_BODY, _MSG_ASCII_BODY):
        if name in streams:
            texts.append(_decode_stream(name, _read(ole, name, ctx)))
            break  # unicode body takes precedence; don't double-count the ascii fallback
    # Subject (property tag 0037) — also worth scanning, and cheap to grab.
    for name in streams:
        if name.startswith("__substg1.0_0037"):
            texts.append(_decode_stream(name, _read(ole, name, ctx)))
    yield Segment(part=part, filename=filename, mime="application/vnd.ms-outlook",
                  source="msg", text="\n".join(t for t in texts if t))


def _extract_generic(ole, streams, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    chunks = []
    for name in streams:
        try:
            data = _read(ole, name, ctx)
        except OSError:
            continue
        for m in _ASCII_RUN.finditer(data):
            chunks.append(m.group().decode("ascii", "replace"))
        for m in _UTF16_RUN.finditer(data):
            chunks.append(m.group().decode("utf-16-le", "replace"))

    yield Segment(part=part, filename=filename, mime="application/x-ole-storage",
                  source="legacy_office", text="\n".join(chunks))
