"""Calls Claude models through kie.ai's native Anthropic Messages API
endpoint — a genuinely different wire format from every other model this
service talks to.

Per docs.kie.ai/market/claude/claude-sonnet-4-6 (and claude-opus-4-6):
  - Endpoint is POST {KIE_AI_BASE_URL}/claude/v1/messages — a single fixed
    path, not kie.ai's usual per-model {base}/{model}/v1/chat/completions
    routing. The model name goes in the JSON body's "model" field instead
    (e.g. "claude-sonnet-4-6").
  - Request/response shape is Anthropic's own Messages API structure, not
    OpenAI chat/completions: content is a list of typed blocks (text /
    image / tool_use), not choices[0].message.content.
  - Response example in kie.ai's docs shows top-level role, content[],
    usage, stop_reason, model, id, credits_consumed, type:"message" —
    exactly Anthropic's own response shape, which is why image input here
    uses Anthropic's content-block format (type:"image", source:{type:
    "base64", media_type, data}) rather than OpenAI's {"type":"image_url"}.
    kie.ai's own docs page doesn't show an image example explicitly, but
    the endpoint is documented as mirroring Anthropic's real API, which has
    no other image format.

Kept deliberately separate from app/llm/providers.py's LLMProvider /
MultiLLMRouter rather than folded in: the shared chat/tool-calling path
(AavishieldAgent) is OpenAI-shaped throughout, and bending that abstraction
to cover one model family's different response shape would be a bigger,
riskier change than this service currently needs — vision classification
is the only caller today.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import httpx


class ClaudeCallError(Exception):
    """Raised on any transport/HTTP/parse failure calling kie.ai's Claude
    endpoint. Callers (vision.py) already wrap model calls in a broad
    except and degrade to the "none" verdict — this is just a clean,
    specific type to catch rather than a bare Exception."""


@dataclass
class ClaudeResponse:
    text: str
    model: str
    raw: dict


# Every Claude model on kie.ai's marketplace shares the fixed "claude" path
# segment; the "model" JSON field, not the URL, selects which one.
CLAUDE_BASE_PATH = "claude"


def is_claude_model(model: str) -> bool:
    return bool(model) and model.strip().lower().startswith("claude")


def image_content_block(image_b64: str, mime: str) -> dict:
    """Anthropic's native image content-block shape — NOT the OpenAI-style
    {"type": "image_url", "image_url": {...}} every other provider here
    uses (see app/vision.py's other branch)."""
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": mime or "image/jpeg", "data": image_b64},
    }


async def call_claude(model: str, system: str, user_content: list[dict],
                       max_tokens: int = 200, timeout_s: int = 60) -> ClaudeResponse:
    """POSTs one message to kie.ai's Claude Messages endpoint. `user_content`
    is a list of Anthropic content blocks (text / image). Raises
    ClaudeCallError on any failure — never returns a partial/garbage result
    silently."""
    api_key = os.getenv("KIE_AI_API_KEY", "")
    if not api_key:
        raise ClaudeCallError("KIE_AI_API_KEY not configured")

    base_url = os.getenv("KIE_AI_BASE_URL", "https://api.kie.ai").rstrip("/")
    url = f"{base_url}/{CLAUDE_BASE_PATH}/v1/messages"

    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user_content}],
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        # kie.ai's Claude docs list these alongside the Authorization
        # bearer token (unlike every other kie.ai model, which needs only
        # Authorization) — sent defensively since an extra, unneeded header
        # is harmless, but a genuinely required one missing here would fail
        # as an opaque 401/400 with no indication why.
        "X-Api-Key": api_key,
        "anthropic-version": os.getenv("ANTHROPIC_VERSION", "2023-06-01"),
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise ClaudeCallError(str(exc)) from exc
    except ValueError as exc:  # non-JSON response body
        raise ClaudeCallError(f"non-JSON response: {exc}") from exc

    if not isinstance(data, dict):
        raise ClaudeCallError(f"unexpected response shape: {type(data).__name__}")

    text_parts = [
        block.get("text", "")
        for block in data.get("content", [])
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    return ClaudeResponse(text="".join(text_parts), model=data.get("model", model), raw=data)
