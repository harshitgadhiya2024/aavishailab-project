"""Shared types for every extractor.

An extractor is a generator function `(FileLike, ExtractContext) -> Iterator[Item]`
registered against one or more MIME types / extensions in `registry.py`. It
never sees the whole document tree at once — it yields items as it goes, so
the caller (extract_stream in engine.py) can stream NDJSON out the door and
the caller-of-the-caller (admin-api) can act on a `block` verdict without
waiting for the rest of a multi-gigabyte archive.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Iterable, Optional, Protocol, Union


@dataclass
class Segment:
    """One unit of extracted text, ready to hand to the DLP detector engine."""
    part: str            # e.g. "q3.zip!/hr/salary.xlsx!Sheet1"
    filename: str         # the real filename of the innermost part, not the
                          # outer request's filename — this is what fixes the
                          # "multipart uploads report the wrong filename" bug
    mime: str
    source: str           # "text" | "csv" | "json" | "xlsx" | "docx" | "pdf" | "ocr" | ...
    text: str

    def to_dict(self, seq: int) -> dict:
        return {
            "kind": "segment", "seq": seq, "part": self.part, "filename": self.filename,
            "mime": self.mime, "source": self.source, "text": self.text,
        }


@dataclass
class ImageSegment:
    """One image, worth sending onward for OCR (already done, in `ocr_text`)
    and optionally vision-AI classification (done by the caller, not here)."""
    part: str
    sha256: str
    mime: str
    w: int
    h: int
    b64: str
    ocr_text: str = ""

    def to_dict(self, seq: int) -> dict:
        return {
            "kind": "image", "seq": seq, "part": self.part, "sha256": self.sha256,
            "mime": self.mime, "w": self.w, "h": self.h, "b64": self.b64, "ocr_text": self.ocr_text,
        }


# Reasons a part could not be fully inspected. These map 1:1 onto a DLP
# policy's `on_unscannable` keys (see the plan's Phase 4 schema) — the
# caller decides allow/alert/block per reason, this layer only reports facts.
UnscannableReason = str  # "encrypted_archive" | "encrypted_document" | "extraction_timeout"
                          # | "unsupported_format" | "unsupported_archive" | "legacy_binary"
                          # | "too_deep" | "too_many_entries" | "expansion_ratio_exceeded"
                          # | "total_bytes_exceeded" | "corrupt"


@dataclass
class Unscannable:
    part: str
    reason: UnscannableReason
    detail: str = ""

    def to_dict(self, seq: int) -> dict:
        return {"kind": "unscannable", "seq": seq, "part": self.part, "reason": self.reason, "detail": self.detail}


Item = Union[Segment, ImageSegment, Unscannable]


class BudgetExceeded(Exception):
    """Raised internally when a safety bound is hit; the engine turns this
    into an Unscannable record for the part in progress rather than letting
    it propagate as a 500."""
    def __init__(self, reason: UnscannableReason, detail: str = ""):
        self.reason = reason
        self.detail = detail
        super().__init__(f"{reason}: {detail}")


@dataclass
class ExtractContext:
    """Mutable state threaded through one top-level extraction call —
    tracks the resource budget so nested archive recursion can't blow past
    it regardless of which extractor is currently running."""
    max_depth: int
    max_entries: int
    max_expansion_ratio: int
    max_total_bytes: int
    part_deadline_ms: int
    deadline_at: float               # time.monotonic() absolute deadline
    ocr_enabled: bool
    images_enabled: bool
    ocr_langs: str = "eng"
    max_images_returned: int = 20
    min_image_dimension: int = 64
    ocr_max_pages: int = 200
    ocr_max_images: int = 50
    ocr_dpi: int = 200
    ocr_text_threshold: int = 100
    ocr_per_image_timeout_s: int = 20

    input_bytes: int = 0
    total_decompressed: int = 0
    entries_seen: int = 0
    images_emitted: int = 0
    ocr_pages: int = 0    # PDF pages OCR'd so far
    ocr_images: int = 0   # standalone/embedded images OCR'd so far
    depth: int = 0

    def images_budget_remaining(self) -> bool:
        return self.images_emitted < self.max_images_returned

    def check_budget(self, added_bytes: int = 0) -> None:
        self.entries_seen += 1
        if self.entries_seen > self.max_entries:
            raise BudgetExceeded("too_many_entries", f"> {self.max_entries} entries")
        self.total_decompressed += added_bytes
        if self.total_decompressed > self.max_total_bytes:
            raise BudgetExceeded("total_bytes_exceeded", f"> {self.max_total_bytes} bytes decompressed")
        if self.input_bytes > 0 and self.total_decompressed > self.input_bytes * self.max_expansion_ratio:
            raise BudgetExceeded("expansion_ratio_exceeded",
                                  f"> {self.max_expansion_ratio}x expansion")
        if time.monotonic() > self.deadline_at:
            raise BudgetExceeded("extraction_timeout", "global deadline reached")

    def part_deadline(self) -> float:
        return min(self.deadline_at, time.monotonic() + self.part_deadline_ms / 1000)

    def child(self) -> "ExtractContext":
        if self.depth + 1 > self.max_depth:
            raise BudgetExceeded("too_deep", f"> {self.max_depth} levels of nesting")
        c = ExtractContext(
            max_depth=self.max_depth, max_entries=self.max_entries,
            max_expansion_ratio=self.max_expansion_ratio, max_total_bytes=self.max_total_bytes,
            part_deadline_ms=self.part_deadline_ms, deadline_at=self.deadline_at,
            ocr_enabled=self.ocr_enabled, images_enabled=self.images_enabled, ocr_langs=self.ocr_langs,
            max_images_returned=self.max_images_returned, min_image_dimension=self.min_image_dimension,
            ocr_max_pages=self.ocr_max_pages, ocr_max_images=self.ocr_max_images, ocr_dpi=self.ocr_dpi,
            ocr_text_threshold=self.ocr_text_threshold, ocr_per_image_timeout_s=self.ocr_per_image_timeout_s,
            input_bytes=self.input_bytes,
        )
        c.depth = self.depth + 1
        # Budgets other than depth are shared by reference semantics via the
        # same counters — simplest way to keep one global ceiling across a
        # whole nested walk is to share the mutable object, so child() copies
        # everything BUT then callers should keep using the child only for
        # `depth`/`ocr_langs` and otherwise let counts flow back up. To avoid
        # subtle double-counting bugs we instead make counters shared here:
        c.total_decompressed = self.total_decompressed
        c.entries_seen = self.entries_seen
        c.images_emitted = self.images_emitted
        c.ocr_pages = self.ocr_pages
        c.ocr_images = self.ocr_images
        return c

    def absorb(self, child: "ExtractContext") -> None:
        """Pull a child context's counters back into this one after a nested
        walk returns, so the shared budget actually decreases headroom for
        siblings at this level too."""
        self.total_decompressed = child.total_decompressed
        self.entries_seen = child.entries_seen
        self.images_emitted = child.images_emitted
        self.ocr_pages = child.ocr_pages
        self.ocr_images = child.ocr_images


class Extractor(Protocol):
    def __call__(self, stream, part: str, filename: str, mime: str, ctx: ExtractContext) -> Iterable[Item]:
        ...
