"""Runtime configuration, sourced from environment variables — same shape and
defaulting convention as dlp-service/app/config.py, so the two services read
the same way in docker-compose and .env.example.

There is deliberately no size ceiling on input here (the product requirement
is "scan everything, no file-size limit"); what IS bounded are the resource
*safety* limits below, which stop a hostile or pathological file from
exhausting CPU/RAM regardless of how big the original upload was. Hitting one
of these produces an explicit `unscannable` record for the caller to act on
(per policy's on_unscannable setting) — never a silent skip.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ[key])
    except (KeyError, ValueError):
        return default


def _env_bool(key: str, default: bool) -> bool:
    v = os.environ.get(key)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    service_secret: str = os.environ.get("EXTRACT_SERVICE_SECRET", "dev-insecure-extract-secret-change-me")
    service_secret_previous: str = os.environ.get("EXTRACT_SERVICE_SECRET_PREVIOUS", "")
    require_auth: bool = _env_bool("EXTRACT_REQUIRE_AUTH", True)

    # Resource safety bounds — see module docstring. None of these are a
    # "file too big" limit; they bound archive-bomb / recursion abuse.
    max_depth: int = _env_int("EXTRACT_MAX_DEPTH", 5)
    max_entries: int = _env_int("EXTRACT_MAX_ENTRIES", 10_000)
    max_expansion_ratio: int = _env_int("EXTRACT_MAX_EXPANSION_RATIO", 200)
    max_total_bytes: int = _env_int("EXTRACT_MAX_TOTAL_BYTES", 1024 * 1024 * 1024)  # 1 GB floor
    part_deadline_ms: int = _env_int("EXTRACT_PART_DEADLINE_MS", 30_000)
    default_deadline_ms: int = _env_int("EXTRACT_DEFAULT_DEADLINE_MS", 120_000)

    # OCR
    ocr_enabled_default: bool = _env_bool("EXTRACT_OCR_DEFAULT", True)
    ocr_langs: str = os.environ.get("EXTRACT_OCR_LANGS", "eng")
    ocr_dpi: int = _env_int("EXTRACT_OCR_DPI", 200)
    ocr_text_threshold: int = _env_int("EXTRACT_OCR_TEXT_THRESHOLD", 100)
    ocr_max_pages: int = _env_int("EXTRACT_OCR_MAX_PAGES", 200)
    ocr_max_images: int = _env_int("EXTRACT_OCR_MAX_IMAGES", 50)
    ocr_per_image_timeout_s: int = _env_int("EXTRACT_OCR_PER_IMAGE_TIMEOUT_S", 20)
    ocr_workers: int = _env_int("EXTRACT_OCR_WORKERS", 2)

    # Images handed back for vision-AI classification (Phase 3). Bounding
    # this here (not just in ai-service) keeps a 500-image PDF from queuing
    # 500 vision calls just because every image technically qualifies.
    max_images_returned: int = _env_int("EXTRACT_MAX_IMAGES_RETURNED", 20)
    min_image_dimension: int = _env_int("EXTRACT_MIN_IMAGE_DIMENSION", 64)

    # Spool threshold for the inbound request body — below this it never
    # touches disk. Mirrors the agent's SPOOL_MEMORY convention.
    spool_memory_bytes: int = _env_int("EXTRACT_SPOOL_MEMORY_BYTES", 8 * 1024 * 1024)


settings = Settings()
