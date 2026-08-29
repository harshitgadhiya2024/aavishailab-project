"""Vision-AI DLP image classification — schema validation is the part with
actual branching to get wrong (a malformed/adversarial model response must
never leak free text into the scoring path), and cost-control (cache +
budget) is what makes this production-viable, so both get direct coverage
here rather than only exercising the happy path.
"""

import base64
import json

import pytest

from app import vision
from app.llm.providers import ChatResponse


# ─── parse_model_output — schema validation ────────────────────────────────

def test_parses_well_formed_response():
    raw = json.dumps({"sensitive": True, "doc_type": "aadhaar_card", "confidence": 92, "evidence": "govt ID layout"})
    v = vision.parse_model_output(raw)
    assert v is not None
    assert v.sensitive is True
    assert v.doc_type == "aadhaar_card"
    assert v.confidence == 92


def test_strips_markdown_code_fence():
    raw = "```json\n" + json.dumps({"sensitive": True, "doc_type": "pan_card", "confidence": 80, "evidence": "x"}) + "\n```"
    v = vision.parse_model_output(raw)
    assert v is not None
    assert v.doc_type == "pan_card"


def test_rejects_unknown_doc_type():
    raw = json.dumps({"sensitive": True, "doc_type": "totally_made_up_type", "confidence": 90, "evidence": "x"})
    assert vision.parse_model_output(raw) is None


def test_rejects_non_json():
    assert vision.parse_model_output("this is not json at all") is None


def test_rejects_json_array_not_object():
    assert vision.parse_model_output("[1, 2, 3]") is None


def test_confidence_clamped_to_0_100():
    raw = json.dumps({"sensitive": True, "doc_type": "id_card", "confidence": 999, "evidence": "x"})
    v = vision.parse_model_output(raw)
    assert v.confidence == 100

    raw2 = json.dumps({"sensitive": True, "doc_type": "id_card", "confidence": -50, "evidence": "x"})
    v2 = vision.parse_model_output(raw2)
    assert v2.confidence == 0


def test_none_doc_type_forces_not_sensitive_even_if_claimed_true():
    """A prompt-injected or confused model claiming sensitive:true with
    doc_type:none must not be trusted — sensitive is only ever true when
    paired with an actual recognized document type."""
    raw = json.dumps({"sensitive": True, "doc_type": "none", "confidence": 50, "evidence": "x"})
    v = vision.parse_model_output(raw)
    assert v.sensitive is False


def test_evidence_truncated_and_missing_confidence_defaults_zero():
    raw = json.dumps({"sensitive": False, "doc_type": "none", "evidence": "y" * 500})
    v = vision.parse_model_output(raw)
    assert v.confidence == 0
    assert len(v.evidence) <= 200


# ─── classify_image — end-to-end with mocked router/redis ─────────────────

class _FakeRouter:
    def __init__(self, response_text=None, raise_exc=None):
        self._text = response_text
        self._exc = raise_exc
        self.calls = []

    async def chat(self, messages, model=None, temperature=0.7, max_tokens=2048, **kw):
        self.calls.append({"model": model, "messages": messages})
        if self._exc:
            raise self._exc
        return ChatResponse(content=self._text, model=model or "fake-model", provider="fake")


class _FakeRedis:
    """Minimal in-memory stand-in for the async redis client surface
    vision.py actually uses (get/set/incr/expire)."""

    def __init__(self):
        self.store = {}
        self.ttl = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ex=None):
        self.store[key] = value
        if ex is not None:
            self.ttl[key] = ex

    async def incr(self, key):
        self.store[key] = str(int(self.store.get(key, "0")) + 1)
        return int(self.store[key])

    async def expire(self, key, seconds):
        self.ttl[key] = seconds


TINY_PNG_B64 = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6360000002000155a3a2c50000000049454e44ae426082"
)).decode("ascii")


@pytest.mark.asyncio
async def test_classify_image_happy_path(monkeypatch):
    fake_router = _FakeRouter(response_text=json.dumps(
        {"sensitive": True, "doc_type": "credit_card", "confidence": 95, "evidence": "card layout"}))
    fake_redis = _FakeRedis()
    monkeypatch.setattr(vision, "get_router", lambda: fake_router)

    async def fake_get_redis():
        return fake_redis
    monkeypatch.setattr(vision, "get_redis", fake_get_redis)

    v = await vision.classify_image("org1", TINY_PNG_B64, "image/png")
    assert v.sensitive is True
    assert v.doc_type == "credit_card"
    assert v.cached is False


@pytest.mark.asyncio
async def test_classify_image_cache_is_scoped_per_model(monkeypatch):
    """Regression test: the cache key must include DLP_VISION_MODEL. Found
    by hand while validating the Claude/Gemini routing live — switching
    models on the same image incorrectly served the OTHER model's cached
    verdict, meaning a model upgrade silently kept using stale results
    until every cached image's TTL expired."""
    fake_redis = _FakeRedis()

    async def fake_get_redis():
        return fake_redis
    monkeypatch.setattr(vision, "get_redis", fake_get_redis)

    monkeypatch.setattr(vision, "DLP_VISION_MODEL", "claude-sonnet-4-6")

    async def fake_call_claude(model, system, user_content, max_tokens=200, timeout_s=60):
        from app.claude_client import ClaudeResponse
        return ClaudeResponse(
            text=json.dumps({"sensitive": True, "doc_type": "aadhaar_card", "confidence": 90, "evidence": "x"}),
            model=model, raw={},
        )
    monkeypatch.setattr(vision.claude_client, "call_claude", fake_call_claude)

    v_claude = await vision.classify_image("org1", TINY_PNG_B64, "image/png")
    assert v_claude.doc_type == "aadhaar_card"
    assert v_claude.cached is False

    # Same image, switched to a different model — must NOT reuse Claude's
    # cached verdict; the (fake) Gemini router below returns something
    # different, and that's what must come back.
    monkeypatch.setattr(vision, "DLP_VISION_MODEL", "gemini-3.1-pro")
    fake_router = _FakeRouter(response_text=json.dumps(
        {"sensitive": False, "doc_type": "none", "confidence": 0, "evidence": "y"}))
    monkeypatch.setattr(vision, "get_router", lambda: fake_router)

    v_gemini = await vision.classify_image("org1", TINY_PNG_B64, "image/png")
    assert v_gemini.cached is False, "must not have served Claude's cached verdict for a different model"
    assert v_gemini.doc_type == "none"
    assert len(fake_router.calls) == 1  # the Gemini model was actually called


@pytest.mark.asyncio
async def test_classify_image_second_call_hits_cache(monkeypatch):
    fake_router = _FakeRouter(response_text=json.dumps(
        {"sensitive": True, "doc_type": "aadhaar_card", "confidence": 88, "evidence": "x"}))
    fake_redis = _FakeRedis()
    monkeypatch.setattr(vision, "get_router", lambda: fake_router)

    async def fake_get_redis():
        return fake_redis
    monkeypatch.setattr(vision, "get_redis", fake_get_redis)

    await vision.classify_image("org1", TINY_PNG_B64, "image/png")
    v2 = await vision.classify_image("org1", TINY_PNG_B64, "image/png")

    assert v2.cached is True
    assert v2.doc_type == "aadhaar_card"
    assert len(fake_router.calls) == 1  # the model was called exactly once


@pytest.mark.asyncio
async def test_classify_image_budget_exhausted(monkeypatch):
    fake_router = _FakeRouter(response_text=json.dumps(
        {"sensitive": True, "doc_type": "id_card", "confidence": 70, "evidence": "x"}))
    fake_redis = _FakeRedis()
    monkeypatch.setattr(vision, "get_router", lambda: fake_router)
    monkeypatch.setattr(vision, "VISION_DAILY_CAP", 1)

    async def fake_get_redis():
        return fake_redis
    monkeypatch.setattr(vision, "get_redis", fake_get_redis)

    # Two different images so the cache doesn't short-circuit the second call.
    img2 = base64.b64encode(base64.b64decode(TINY_PNG_B64) + b"\x00").decode("ascii")

    v1 = await vision.classify_image("org1", TINY_PNG_B64, "image/png")
    v2 = await vision.classify_image("org1", img2, "image/png")

    assert v1.budget_exhausted is False
    assert v2.budget_exhausted is True
    assert v2.sensitive is False
    assert len(fake_router.calls) == 1  # the second call never reached the model


@pytest.mark.asyncio
async def test_classify_image_provider_failure_degrades_to_none(monkeypatch):
    fake_router = _FakeRouter(raise_exc=RuntimeError("all providers failed"))
    monkeypatch.setattr(vision, "get_router", lambda: fake_router)

    async def fake_get_redis():
        raise RuntimeError("redis unavailable")
    monkeypatch.setattr(vision, "get_redis", fake_get_redis)

    v = await vision.classify_image("org1", TINY_PNG_B64, "image/png")
    assert v.sensitive is False
    assert v.doc_type == "none"


@pytest.mark.asyncio
async def test_classify_image_malformed_model_output_degrades_to_none(monkeypatch):
    fake_router = _FakeRouter(response_text="I cannot help with that request.")
    monkeypatch.setattr(vision, "get_router", lambda: fake_router)

    async def fake_get_redis():
        raise RuntimeError("redis unavailable")
    monkeypatch.setattr(vision, "get_redis", fake_get_redis)

    v = await vision.classify_image("org1", TINY_PNG_B64, "image/png")
    assert v.sensitive is False
    assert v.doc_type == "none"


@pytest.mark.asyncio
async def test_classify_image_bad_base64_returns_none_without_calling_model(monkeypatch):
    fake_router = _FakeRouter(response_text="{}")
    monkeypatch.setattr(vision, "get_router", lambda: fake_router)

    v = await vision.classify_image("org1", "not-valid-base64!!!", "image/png")
    assert v.doc_type == "none"
    assert len(fake_router.calls) == 0


# ─── model routing: Claude (Anthropic-native via kie.ai) vs OpenAI-compatible ──
# kie.ai serves Claude through a genuinely different endpoint/wire format
# than every other model (see app/claude_client.py) — classify_image must
# route to the right one based on DLP_VISION_MODEL, never silently send a
# Claude model name through the OpenAI-compatible path (which would 404) or
# vice versa.

@pytest.mark.asyncio
async def test_classify_image_routes_gemini_through_openai_compatible_router(monkeypatch):
    fake_router = _FakeRouter(response_text=json.dumps(
        {"sensitive": True, "doc_type": "passport", "confidence": 88, "evidence": "x"}))
    monkeypatch.setattr(vision, "get_router", lambda: fake_router)
    monkeypatch.setattr(vision, "DLP_VISION_MODEL", "gemini-3.1-pro")

    async def claude_should_not_be_called(*a, **kw):
        raise AssertionError("Claude path must not be used for a Gemini model")
    monkeypatch.setattr(vision.claude_client, "call_claude", claude_should_not_be_called)

    async def fake_get_redis():
        raise RuntimeError("no redis in this test")
    monkeypatch.setattr(vision, "get_redis", fake_get_redis)

    v = await vision.classify_image("org1", TINY_PNG_B64, "image/png")
    assert v.doc_type == "passport"
    assert len(fake_router.calls) == 1
    assert fake_router.calls[0]["model"] == "gemini-3.1-pro"


@pytest.mark.asyncio
async def test_classify_image_routes_claude_through_claude_client(monkeypatch):
    monkeypatch.setattr(vision, "DLP_VISION_MODEL", "claude-sonnet-4-6")

    router_calls = []

    def router_should_not_be_used():
        router_calls.append(1)
        raise AssertionError("OpenAI-compatible router must not be used for a Claude model")
    monkeypatch.setattr(vision, "get_router", router_should_not_be_used)

    captured = {}

    async def fake_call_claude(model, system, user_content, max_tokens=200, timeout_s=60):
        captured["model"] = model
        captured["user_content"] = user_content
        from app.claude_client import ClaudeResponse
        return ClaudeResponse(
            text=json.dumps({"sensitive": True, "doc_type": "credit_card", "confidence": 97, "evidence": "x"}),
            model=model, raw={},
        )
    monkeypatch.setattr(vision.claude_client, "call_claude", fake_call_claude)

    async def fake_get_redis():
        raise RuntimeError("no redis in this test")
    monkeypatch.setattr(vision, "get_redis", fake_get_redis)

    v = await vision.classify_image("org1", TINY_PNG_B64, "image/png")

    assert v.sensitive is True
    assert v.doc_type == "credit_card"
    assert captured["model"] == "claude-sonnet-4-6"
    # The image must be sent as an Anthropic-native content block, not
    # OpenAI's {"type": "image_url", ...} shape.
    image_blocks = [b for b in captured["user_content"] if b.get("type") == "image"]
    assert len(image_blocks) == 1
    assert image_blocks[0]["source"]["type"] == "base64"
    assert not router_calls


@pytest.mark.asyncio
async def test_classify_image_claude_failure_degrades_to_none(monkeypatch):
    monkeypatch.setattr(vision, "DLP_VISION_MODEL", "claude-opus-4-6")

    async def failing_call_claude(*a, **kw):
        from app.claude_client import ClaudeCallError
        raise ClaudeCallError("simulated failure")
    monkeypatch.setattr(vision.claude_client, "call_claude", failing_call_claude)

    async def fake_get_redis():
        raise RuntimeError("no redis in this test")
    monkeypatch.setattr(vision, "get_redis", fake_get_redis)

    v = await vision.classify_image("org1", TINY_PNG_B64, "image/png")
    assert v.sensitive is False
    assert v.doc_type == "none"
