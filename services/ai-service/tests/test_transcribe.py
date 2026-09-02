"""Best-effort speech-to-text for DLP audio/video (Task 3). The contract
that matters: it never raises, and any failure returns ok=False / empty
text so the caller records the part unscannable. Mocked — no real calls.
"""

import pytest

from app import transcribe
from app.llm.providers import ChatResponse


class _FakeRouter:
    def __init__(self, text=None, exc=None):
        self._text, self._exc = text, exc
        self.calls = []

    async def chat(self, messages, model=None, **kw):
        self.calls.append(model)
        if self._exc:
            raise self._exc
        return ChatResponse(content=self._text, model=model or "fake", provider="fake")


class _FakeRedis:
    def __init__(self):
        self.store = {}

    async def get(self, k):
        return self.store.get(k)

    async def set(self, k, v, ex=None):
        self.store[k] = v

    async def incr(self, k):
        self.store[k] = str(int(self.store.get(k, "0")) + 1)
        return int(self.store[k])

    async def expire(self, k, s):
        pass


def _wire(mp, router, redis):
    mp.setattr(transcribe, "get_router", lambda: router)

    async def g():
        return redis
    mp.setattr(transcribe, "get_redis", g)


@pytest.mark.asyncio
async def test_transcribe_happy_path(monkeypatch):
    _wire(monkeypatch, _FakeRouter(text="my card number is on the invoice"), _FakeRedis())
    r = await transcribe.transcribe("org1", "QUJD", "audio/mpeg")
    assert r["ok"] is True
    assert "invoice" in r["text"]


@pytest.mark.asyncio
async def test_transcribe_provider_error_is_soft(monkeypatch):
    _wire(monkeypatch, _FakeRouter(exc=RuntimeError("no audio model")), _FakeRedis())
    r = await transcribe.transcribe("org1", "QUJD", "audio/mpeg")
    assert r["ok"] is False
    assert r["text"] == ""


@pytest.mark.asyncio
async def test_transcribe_empty_input(monkeypatch):
    _wire(monkeypatch, _FakeRouter(text="x"), _FakeRedis())
    r = await transcribe.transcribe("org1", "", "audio/mpeg")
    assert r["ok"] is False
