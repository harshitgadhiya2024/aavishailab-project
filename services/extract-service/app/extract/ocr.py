"""Tesseract OCR wrapper.

pytesseract shells out to the `tesseract` binary as a subprocess per call
and accepts a `timeout` — that subprocess boundary is what keeps a
pathological image from ever blocking (let alone crashing) this service's
own process, so no separate worker-pool is needed here the way the plan's
ProcessPoolExecutor note anticipated for a pure-Python OCR path; the
timeout below is the actual enforcement mechanism.
"""

from __future__ import annotations

import logging

import pytesseract
from PIL import Image, ImageOps

log = logging.getLogger(__name__)


def preprocess_for_ocr(img: Image.Image) -> Image.Image:
    """Grayscale + autocontrast + upscale-if-small — cheap preprocessing
    that measurably helps Tesseract on photographed (as opposed to
    cleanly-rendered) documents: a phone photo of an Aadhaar card, not a
    programmatically generated PDF page."""
    img = img.convert("L")
    img = ImageOps.autocontrast(img)
    if img.width and img.width < 1000:
        scale = 1000 / img.width
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    return img


def ocr_image(img: Image.Image, langs: str = "eng", timeout_s: int = 20) -> str:
    """Returns recognised text, or "" on any failure/timeout — OCR
    degrading to "no text found" must never take extraction down."""
    try:
        processed = preprocess_for_ocr(img)
        return pytesseract.image_to_string(
            processed, lang=langs, timeout=timeout_s, config="--oem 1 --psm 3"
        ).strip()
    except RuntimeError as exc:  # pytesseract's own timeout signal — routine
        log.debug("tesseract timed out after %ss: %s", timeout_s, exc)
        return ""
    except pytesseract.TesseractError as exc:  # a bad/unreadable image — routine
        log.debug("tesseract error: %s", exc)
        return ""
    except Exception as exc:  # pragma: no cover - defensive catch-all
        # Anything else here (a missing/unwritable temp dir, the tesseract
        # binary not found, a permissions problem) is an environment/
        # deployment fault, not a bad image — and it would otherwise fail
        # *every* OCR call identically and silently, which is exactly what
        # happened once in testing (a tmpfs mount pytesseract's own temp
        # file needed turned out to be unwritable by this container's
        # non-root user — see docker-compose.yml's extract-service
        # comment). Logged at warning, not debug, so that class of failure
        # is never invisible in production again.
        log.warning("OCR failed unexpectedly (image sensitive-content detection may be degraded): %s", exc)
        return ""
