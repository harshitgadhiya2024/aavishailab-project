"""PDF text extraction and scanned-page OCR, via pypdfium2 (BSD/Apache-2.0
— PyMuPDF is deliberately NOT used here despite being a common choice: it
is AGPL-3.0, which is incompatible with shipping this as closed-source
commercial software).

Per page: pull the text layer first; if it's sparse (below
ocr_text_threshold characters — the signature of a scanned/photographed
page with no real text layer, just an image), rasterise the page and OCR
it. This is the literal "PDF ki images ko analyse karo" requirement.
"""

from __future__ import annotations

import io
import logging
from typing import Iterable

import pypdfium2 as pdfium

from .base import ExtractContext, Item, Segment, Unscannable
from .images import bytes_to_image_segment

log = logging.getLogger(__name__)


def extract(stream, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    data = stream.read()
    ctx.check_budget(len(data))

    try:
        pdf = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as exc:
        # pypdfium2 raises the same error class for corruption and for a
        # password-protected document — treat as encrypted, the more
        # actionable (and more common in practice) of the two.
        yield Unscannable(part=part, reason="encrypted_document", detail=str(exc))
        return

    try:
        try:
            n_pages = len(pdf)
        except Exception as exc:
            yield Unscannable(part=part, reason="corrupt", detail=str(exc))
            return

        for i in range(n_pages):
            try:
                ctx.check_budget()
            except Exception:
                raise
            page_part = f"{part}!page{i + 1}"
            yield from _extract_page(pdf, i, page_part, filename, ctx)
    finally:
        pdf.close()


def _extract_page(pdf: "pdfium.PdfDocument", index: int, page_part: str, filename: str,
                   ctx: ExtractContext) -> Iterable[Item]:
    try:
        page = pdf[index]
    except Exception as exc:
        yield Unscannable(part=page_part, reason="corrupt", detail=str(exc))
        return

    text = ""
    try:
        textpage = page.get_textpage()
        # get_text_bounded() with no explicit rect silently clips to a
        # default viewport and can drop trailing text on a normal page —
        # confirmed against a real PDF during testing. get_text_range()
        # over the full char count has no such bound and is what a scanner
        # wants: every character on the page, regardless of layout.
        text = textpage.get_text_range(0, textpage.count_chars()) or ""
    except Exception as exc:
        log.debug("text extraction failed for %s: %s", page_part, exc)

    if text.strip():
        yield Segment(part=page_part, filename=filename, mime="application/pdf", source="pdf", text=text)

    if len(text.strip()) >= ctx.ocr_text_threshold:
        return  # real text layer present — not a scanned page, skip OCR

    if not ctx.ocr_enabled or ctx.ocr_pages >= ctx.ocr_max_pages:
        return

    try:
        bitmap = page.render(scale=ctx.ocr_dpi / 72)
        pil_image = bitmap.to_pil()
    except Exception as exc:
        yield Unscannable(part=page_part, reason="corrupt", detail=f"page render failed: {exc}")
        return

    buf = io.BytesIO()
    pil_image.save(buf, format="PNG")
    png_bytes = buf.getvalue()
    ctx.check_budget(len(png_bytes))

    seg = bytes_to_image_segment(png_bytes, page_part, ctx, count_as="page")
    if seg is None:
        return
    if ctx.images_budget_remaining():
        ctx.images_emitted += 1
        yield seg
    if seg.ocr_text:
        yield Segment(part=page_part, filename=filename, mime="application/pdf", source="ocr", text=seg.ocr_text)
