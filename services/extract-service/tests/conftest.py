from __future__ import annotations

import io
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.extract.base import ExtractContext, ImageSegment, Segment, Unscannable
from app.extract.engine import extract_stream


def make_ctx(**overrides) -> ExtractContext:
    defaults = dict(
        max_depth=5,
        max_entries=10_000,
        max_expansion_ratio=200,
        max_total_bytes=1024 * 1024 * 1024,
        part_deadline_ms=30_000,
        deadline_at=time.monotonic() + 120,
        ocr_enabled=True,
        images_enabled=True,
        ocr_langs="eng",
        max_images_returned=20,
        min_image_dimension=32,   # lower than production default so small
                                  # synthetic test images still qualify
        ocr_max_pages=200,
        ocr_max_images=50,
        ocr_dpi=200,
        ocr_text_threshold=100,
        ocr_per_image_timeout_s=20,
    )
    defaults.update(overrides)
    return ExtractContext(**defaults)


def run_extract(data: bytes, filename: str = "", content_type: str = "", ctx: ExtractContext | None = None):
    ctx = ctx or make_ctx(input_bytes=len(data))
    stream = io.BytesIO(data)
    return list(extract_stream(stream, filename, content_type, ctx)), ctx


def all_text(items) -> str:
    return "\n".join(i.text for i in items if isinstance(i, Segment))


def unscannable_reasons(items) -> list[str]:
    return [i.reason for i in items if isinstance(i, Unscannable)]


def image_items(items):
    return [i for i in items if isinstance(i, ImageSegment)]


@pytest.fixture
def ctx_factory():
    return make_ctx
