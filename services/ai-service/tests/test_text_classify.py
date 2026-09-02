"""LLM text-classification for DLP (Task 2). Same test priorities as
test_vision.py: strict schema validation (a malformed / prompt-injected
model response must never leak free text into scoring) and the cache /
budget cost controls. Every test mocks the router and Redis — no real
model calls.
"""

import json

import pytest

from app import text_classify
from app.llm.providers import ChatResponse


# ─── parse_model_output — schema validation ────────────────────────────────

def test_parses_well_formed_response():
    raw = json.dumps({"sensitive": True, "categories": ["salary_data", "employee_pii"],
                      "confidence": 88, "evidence": "compensation table"})
    v = text_classify.parse_model_output(raw)
    assert v is not None
    assert v.sensitive is True
    assert "salary_data" in v.categories
    assert v.confidence == 88


def test_strips_markdown_code_fence():
    raw = "```json\n" + json.dumps({"sensitive": True, "categories": ["contract"],
                                    "confidence": 70, "evidence": "x"}) + "\n```"
    v = text_classify.parse_model_output(raw)
    assert v is not None and v.categories == ["contract"]


def test_unknown_categories_filtered_out():
    raw = json.dumps({"sensitive": True, "categories": ["made_up", "financial"],
                      "confidence": 60, "evidence": "x"})
    v = text_classify.parse_model_output(raw)
    assert v.categories == ["financial"]


def test_all_unknown_categories_becomes_none_and_not_sensitive():
    raw = json.dumps({"sensitive": True, "categories": ["nonsense"], "confidence": 90, "evidence": "x"})
    v = text_classify.parse_model_output(raw)
    assert v.sensitive is False
    assert v.categories == ["none"]


def test_rejects_non_json():
    assert text_classify.parse_model_output("not json") is None


def test_rejects_json_array():
    assert text_classify.parse_model_output("[1,2,3]") is None


def test_confidence_clamped():
    v = text_classify.parse_model_output(json.dumps(
        {"sensitive": True, "categories": ["financial"], "confidence": 999, "evidence": "x"}))
    assert v.confidence == 100


def test_sensitive_true_with_only_none_category_is_forced_false():
    raw = json.dumps({"sensitive": True, "categories": ["none"], "confidence": 50, "evidence": "x"})
    v = text_classify.parse_model_output(raw)
    assert v.sensitive is False


def test_evidence_truncated():
    raw = json.dumps({"sensitive": False, "categories": ["none"], "evidence": "z" * 400})
    v = text_classify.parse_model_output(raw)
    assert len(v.evidence) <= 200


# ─── classify_text — end-to-end with mocked router/redis ──────────────────

class _FakeRouter:
    def __init__(self, response_text=None, raise_exc=None):
        self._text = response_text
        self._exc = raise_exc
        self.calls = []

    async def chat(self, messages, model=None, temperature=0.7, max_tokens=2048, **kw):
        self.calls.append({"model": model, "messages": messages})
        if self._exc:
            raise self._exc
        return ChatResponse(content=self._text, model=model or "fake", provider="fake")


class _FakeRedis:
    def __init__(self):
        self.store = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ex=None):
        self.store[key] = value

    async def incr(self, key):
        self.store[key] = str(int(self.store.get(key, "0")) + 1)
        return int(self.store[key])

    async def expire(self, key, seconds):
        pass


def _wire(monkeypatch, router, redis):
    monkeypatch.setattr(text_classify, "get_router", lambda: router)

    async def fake_get_redis():
        return redis
    monkeypatch.setattr(text_classify, "get_redis", fake_get_redis)


@pytest.mark.asyncio
async def test_classify_text_happy_path(monkeypatch):
    router = _FakeRouter(response_text=json.dumps(
        {"sensitive": True, "categories": ["salary_data"], "confidence": 91, "evidence": "salary column"}))
    redis = _FakeRedis()
    _wire(monkeypatch, router, redis)

    v = await text_classify.classify_text("org1", "Name, CTC, Bonus\nAsha, 2400000, 300000")
    assert v.sensitive is True
    assert v.confidence == 91
    assert len(router.calls) == 1


@pytest.mark.asyncio
async def test_classify_text_second_call_is_cached(monkeypatch):
    router = _FakeRouter(response_text=json.dumps(
        {"sensitive": True, "categories": ["financial"], "confidence": 75, "evidence": "forecast"}))
    redis = _FakeRedis()
    _wire(monkeypatch, router, redis)

    a = await text_classify.classify_text("org1", "FY26 revenue forecast: confidential")
    b = await text_classify.classify_text("org1", "FY26 revenue forecast: confidential")
    assert a.sensitive and b.sensitive
    assert b.cached is True
    assert len(router.calls) == 1  # second call served from cache


@pytest.mark.asyncio
async def test_classify_text_budget_exhausted_degrades(monkeypatch):
    router = _FakeRouter(response_text=json.dumps(
        {"sensitive": True, "categories": ["financial"], "confidence": 90, "evidence": "x"}))
    redis = _FakeRedis()
    _wire(monkeypatch, router, redis)
    monkeypatch.setattr(text_classify, "TEXT_DAILY_CAP", 1)

    await text_classify.classify_text("org2", "doc one, sensitive stuff")
    second = await text_classify.classify_text("org2", "doc two, different sensitive stuff")
    assert second.sensitive is False
    assert second.budget_exhausted is True


@pytest.mark.asyncio
async def test_classify_text_provider_error_degrades_to_not_sensitive(monkeypatch):
    router = _FakeRouter(raise_exc=RuntimeError("all providers failed"))
    redis = _FakeRedis()
    _wire(monkeypatch, router, redis)

    v = await text_classify.classify_text("org3", "some text")
    assert v.sensitive is False
    assert v.categories == ["none"]


@pytest.mark.asyncio
async def test_classify_text_empty_input_no_call(monkeypatch):
    router = _FakeRouter(response_text="{}")
    redis = _FakeRedis()
    _wire(monkeypatch, router, redis)

    v = await text_classify.classify_text("org4", "   ")
    assert v.sensitive is False
    assert len(router.calls) == 0
