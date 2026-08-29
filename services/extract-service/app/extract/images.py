"""Standalone images (.png/.jpg/.webp/.tiff/.bmp/.gif) and the shared
bytes->ImageSegment helper used by ooxml.py (embedded media) and pdf.py
(rasterised scanned pages).

Every image that passes the minimum-dimension filter gets OCR'd (subject to
the ocr_max_images/ocr_max_pages budget) and downscaled to a vision-model
sized JPEG so the caller can hand it to ai-service's classify-image endpoint
(Phase 3) without re-decoding anything.
"""

from __future__ import annotations

import base64
import hashlib
import io
from typing import Iterable, Optional

from PIL import Image, UnidentifiedImageError

from .base import ExtractContext, Item, ImageSegment, Segment, Unscannable
from .ocr import ocr_image

# The long-edge size most vision models tile at, and a quality that keeps a
# typical document photo under ~250KB — see Phase 3 of the plan.
VISION_LONG_EDGE = 1568
VISION_JPEG_QUALITY = 80


def bytes_to_image_segment(data: bytes, part: str, ctx: ExtractContext, count_as: str = "image") -> Optional[ImageSegment]:
    """Decodes `data` as an image and returns an ImageSegment (with OCR text
    already filled in, budget permitting), or None if it isn't a readable
    image or is too small to plausibly hold a document/ID card.

    `count_as` selects which OCR budget this call draws against: "image"
    for standalone/embedded images (ctx.ocr_images / ocr_max_images), "page"
    for a rasterised PDF page (ctx.ocr_pages / ocr_max_pages) — kept
    separate so a PDF with many scanned pages and a DOCX with many embedded
    photos don't silently steal OCR budget from each other."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError):
        return None

    w, h = img.size
    if w < ctx.min_image_dimension or h < ctx.min_image_dimension:
        return None

    ocr_text = ""
    if count_as == "page":
        under_budget = ctx.ocr_pages < ctx.ocr_max_pages
    else:
        under_budget = ctx.ocr_images < ctx.ocr_max_images
    if ctx.ocr_enabled and under_budget:
        ocr_text = ocr_image(img, langs=ctx.ocr_langs, timeout_s=ctx.ocr_per_image_timeout_s)
        if count_as == "page":
            ctx.ocr_pages += 1
        else:
            ctx.ocr_images += 1

    thumb = img.convert("RGB")
    thumb.thumbnail((VISION_LONG_EDGE, VISION_LONG_EDGE), Image.LANCZOS)
    buf = io.BytesIO()
    thumb.save(buf, format="JPEG", quality=VISION_JPEG_QUALITY)

    return ImageSegment(
        part=part,
        sha256=hashlib.sha256(data).hexdigest(),
        mime="image/jpeg",
        w=w, h=h,
        b64=base64.b64encode(buf.getvalue()).decode("ascii"),
        ocr_text=ocr_text,
    )


def extract(stream, part: str, filename: str, family: str, ctx: ExtractContext) -> Iterable[Item]:
    data = stream.read()
    ctx.check_budget(len(data))
    if not ctx.images_enabled or not ctx.images_budget_remaining():
        return

    seg = bytes_to_image_segment(data, part, ctx)
    if seg is None:
        yield Unscannable(part=part, reason="corrupt", detail=f"unreadable {family} image")
        return

    ctx.images_emitted += 1
    yield seg
    if seg.ocr_text:
        # OCR output flows through the identical detector pipeline as any
        # other text segment — Aadhaar/PAN/card detection needs zero
        # detector-side changes to work on a photographed document.
        yield Segment(part=part, filename=filename, mime=f"image/{family}", source="ocr", text=seg.ocr_text)
