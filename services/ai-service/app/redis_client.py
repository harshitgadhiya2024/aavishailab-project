"""Lazy async Redis client, shared by anything in this service that wants
one — currently just vision.py's classification cache and daily-budget
counter. Connects on first use and is reused across requests; an absent or
unreachable REDIS_URL degrades every caller to "treat as unavailable" (see
the broad except blocks around every call site in vision.py), never a
crash — Redis here is a cost-control optimization, not a correctness
dependency.
"""

from __future__ import annotations

import os
from typing import Optional

import redis.asyncio as aioredis

_client: Optional["aioredis.Redis"] = None


async def get_redis() -> "aioredis.Redis":
    global _client
    if _client is None:
        url = os.getenv("REDIS_URL", "")
        if not url:
            raise RuntimeError("REDIS_URL not configured")
        _client = aioredis.from_url(url, decode_responses=True)
    return _client


async def reset_for_tests() -> None:
    """Test-only: drops the cached client so a test can point it at a fresh
    fakeredis/mock instance without a previous test's connection leaking in."""
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        except Exception:
            pass
    _client = None
