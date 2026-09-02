"""Best-effort speech-to-text for DLP (Task 3 — audio/video content should
be scannable, not a blind spot). OpenRouter has no dedicated Whisper
endpoint, but audio-capable chat models (Gemini flash, GPT-4o-audio)
accept an inline `input_audio` content part through the same
OpenAI-compatible chat-completions surface, so transcription is just
another model call on the existing router.

Fails soft: any failure (model can't take audio, provider error, Redis
down) returns {"ok": false, "text": ""} and the caller records the part
as `unscannable` for the org's on_unscannable policy to decide — a
transcription outage never blocks or crashes DLP.

Cost controls mirror vision.py / text_classify.py: sha256(audio) cache,
per-org daily budget.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os

from .llm.providers import Message, get_router
from .redis_client import get_redis

logger = logging.getLogger(__name__)

DLP_AUDIO_MODEL = os.getenv("DLP_AUDIO_MODEL", "google/gemini-2.5-flash")
AUDIO_CACHE_TTL_SECONDS = int(os.getenv("DLP_AUDIO_CACHE_TTL_SECONDS", str(30 * 24 * 3600)))
AUDIO_DAILY_CAP = int(os.getenv("DLP_AUDIO_DAILY_CAP", "500"))
PROMPT_VERSION = "v1"

_SYSTEM_PROMPT = (
    "You are a transcription engine. Transcribe the spoken words in the "
    "supplied audio verbatim, in the original language. Output ONLY the "
    "transcript text — no commentary, no JSON, no timestamps. If there is "
    "no intelligible speech, output an empty string."
)

_FORMAT_BY_MIME = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/flac": "flac", "audio/mp4": "mp4",
    "audio/m4a": "m4a", "audio/aac": "aac",
}


def _fmt(mime: str) -> str:
    return _FORMAT_BY_MIME.get((mime or "").split(";")[0].strip().lower(), "mp3")


def _cache_key(audio_sha256: str) -> str:
    return f"dlp:aud:{audio_sha256}:{PROMPT_VERSION}:{DLP_AUDIO_MODEL or 'default'}"


def _budget_key(org_id: str) -> str:
    return f"dlp:aud:budget:{org_id}:{datetime.date.today().isoformat()}"


async def _call_audio_model(audio_b64: str, mime: str) -> str:
    router = get_router()
    messages = [
        Message(role="system", content=_SYSTEM_PROMPT),
        Message(role="user", content=[
            {"type": "text", "text": "Transcribe this audio."},
            {"type": "input_audio", "input_audio": {"data": audio_b64, "format": _fmt(mime)}},
        ]),
    ]
    resp = await router.chat(messages, model=DLP_AUDIO_MODEL or None, temperature=0.0, max_tokens=4000)
    return (resp.content or "").strip()


async def transcribe(org_id: str, audio_b64: str, mime: str = "audio/mpeg") -> dict:
    """Never raises. {"ok": bool, "text": str, "cached": bool,
    "budget_exhausted": bool}."""
    if not audio_b64:
        return {"ok": False, "text": "", "cached": False, "budget_exhausted": False}
    audio_hash = hashlib.sha256(audio_b64.encode("ascii", "ignore")).hexdigest()

    redis_client = None
    try:
        redis_client = await get_redis()
    except Exception as exc:
        logger.debug("transcribe: redis unavailable (%s)", exc)

    if redis_client is not None:
        try:
            cached = await redis_client.get(_cache_key(audio_hash))
            if cached is not None:
                return {"ok": bool(cached), "text": cached, "cached": True, "budget_exhausted": False}
        except Exception as exc:
            logger.debug("transcribe: cache read failed: %s", exc)
        try:
            count = await redis_client.incr(_budget_key(org_id))
            if count == 1:
                await redis_client.expire(_budget_key(org_id), 26 * 3600)
            if count > AUDIO_DAILY_CAP:
                logger.info("transcribe: daily budget exhausted for org %s", org_id)
                return {"ok": False, "text": "", "cached": False, "budget_exhausted": True}
        except Exception as exc:
            logger.debug("transcribe: budget check failed: %s", exc)

    try:
        text = await _call_audio_model(audio_b64, mime)
    except Exception as exc:
        logger.warning("transcribe: call failed for org %s: %s", org_id, exc)
        return {"ok": False, "text": "", "cached": False, "budget_exhausted": False}

    if redis_client is not None and text:
        try:
            await redis_client.set(_cache_key(audio_hash), text, ex=AUDIO_CACHE_TTL_SECONDS)
        except Exception as exc:
            logger.debug("transcribe: cache write failed: %s", exc)

    return {"ok": bool(text), "text": text, "cached": False, "budget_exhausted": False}
