"""The dispatcher: sniffs a stream's real format and routes it to the right
extractor. `dispatch` is what every recursive extractor (archive, ooxml
media walk, .eml attachments, multipart parts) calls back into — that's
the one place format support gets added, and it's the reason a ZIP full of
DOCX-full-of-images-full-of-scanned-PDFs all Just Works without each
extractor knowing about any of the others.

`extract_stream` is the public entrypoint used by main.py: it also owns the
one special case that can't be sniffed from bytes at all — multipart/form-
data, whose boundary lives only in the caller-declared Content-Type header.
"""

from __future__ import annotations

import logging
from typing import Iterable

from .. import sniff
from .base import BudgetExceeded, ExtractContext, Item, Unscannable
from . import text as text_ex

log = logging.getLogger(__name__)


def dispatch(stream, part: str, filename: str, content_type: str, ctx: ExtractContext) -> Iterable[Item]:
    try:
        ctx.check_budget()
    except BudgetExceeded as e:
        yield Unscannable(part=part, reason=e.reason, detail=e.detail)
        return

    pos = stream.tell()
    head = stream.read(8192)
    stream.seek(pos)
    family = sniff.sniff_family(head, filename, content_type)

    try:
        if family == "zip":
            kind = sniff.sniff_zip_kind(stream)
            if kind in ("docx", "xlsx", "pptx"):
                from . import ooxml
                yield from ooxml.extract(stream, part, filename, content_type, ctx, kind)
            else:
                from . import archive
                yield from archive.extract_zip(stream, part, filename, ctx)
        elif family == "gzip":
            from . import archive
            yield from archive.extract_gzip(stream, part, filename, ctx)
        elif family == "tar":
            from . import archive
            yield from archive.extract_tar(stream, part, filename, ctx)
        elif family == "rar":
            yield Unscannable(part=part, reason="unsupported_archive", detail="RAR archives are not supported")
        elif family == "7z":
            from . import archive
            yield from archive.extract_7z(stream, part, filename, ctx)
        elif family == "pdf":
            from . import pdf as pdf_ex
            yield from pdf_ex.extract(stream, part, filename, ctx)
        elif family == "ole":
            from . import legacy_office
            yield from legacy_office.extract(stream, part, filename, ctx)
        elif family in ("png", "jpeg", "gif", "bmp", "webp", "tiff"):
            from . import images
            yield from images.extract(stream, part, filename, family, ctx)
        elif family == "rtf":
            from . import rtf as rtf_ex
            yield from rtf_ex.extract(stream, part, filename, ctx)
        elif family in ("eml", "eml_mbox"):
            from . import email_fmt
            yield from email_fmt.extract(stream, part, filename, ctx)
        elif family == "csv":
            yield from text_ex.extract_csv(stream, part, filename, content_type, ctx)
        elif family == "json":
            yield from text_ex.extract_json(stream, part, filename, content_type, ctx)
        elif family == "urlencoded":
            yield from text_ex.extract_urlencoded(stream, part, filename, content_type, ctx)
        elif family in ("xml", "html"):
            yield from text_ex.extract_xml_or_html(stream, part, filename, content_type, ctx)
        elif family == "text":
            yield from text_ex.extract_text(stream, part, filename, content_type, ctx)
        else:
            yield Unscannable(part=part, reason="unsupported_format", detail=f"family={family}")
    except BudgetExceeded as e:
        yield Unscannable(part=part, reason=e.reason, detail=e.detail)
    except Exception as exc:  # noqa: BLE001 - a parser bug must degrade this one
                               # part to unscannable, never take the whole
                               # extraction (or the service) down.
        log.warning("extractor error on part %s (family=%s): %s", part, family, exc)
        yield Unscannable(part=part, reason="corrupt", detail=f"{type(exc).__name__}: {exc}")


def extract_stream(stream, filename: str, content_type: str, ctx: ExtractContext) -> Iterable[Item]:
    """Top-level entrypoint. `stream` must be seekable (a spooled temp file
    or BytesIO) — every extractor below relies on tell()/seek() to sniff
    without consuming, and archive recursion re-wraps each entry's bytes in
    a fresh BytesIO rather than sharing this one."""
    root_part = filename or "content"

    ct = (content_type or "").split(";", 1)[0].strip().lower()
    if ct == "multipart/form-data":
        from . import multipart
        yield from multipart.extract(stream, root_part, filename, content_type, ctx)
        return

    yield from dispatch(stream, root_part, filename, content_type, ctx)
