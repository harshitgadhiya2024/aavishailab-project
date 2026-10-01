"""The LLM client's resilience against a fake OpenRouter: transient errors are
retried on the same model, a dead model falls through to the next in the
chain, and every request carries the OpenRouter routing/privacy fields."""

import json

import httpx
import pytest

from app.llm import providers
from app.llm.providers import LLMProvider, Message, ProviderConfig, retry_delay

OK = {"choices": [{"message": {"content": "fine"}, "finish_reason": "stop"}], "usage": {}}
SSE = "data: " + json.dumps({"choices": [{"delta": {"content": "fine"}}]}) + "\ndata: [DONE]\n"


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    async def instant(_):
        return None
    monkeypatch.setattr(providers.asyncio, "sleep", instant)


def fake(seen, *, stream=False):
    """'dead' always 400; 'flaky' 429 twice then OK; anything else OK."""
    def handle(req: httpx.Request):
        body = json.loads(req.content)
        seen.append(body)
        model = body["model"]
        flaky = sum(1 for b in seen if b["model"] == "flaky")
        if model == "dead":
            return httpx.Response(400, json={"error": "not a valid model"})
        if model == "flaky" and flaky <= 2:
            return httpx.Response(429, headers={"retry-after": "0"}, json={"error": "rate limited"})
        return httpx.Response(200, text=SSE) if stream else httpx.Response(200, json=OK)
    return handle


def provider(seen, models, *, stream=False):
    p = LLMProvider(ProviderConfig(
        name="openrouter", base_url="http://llm", api_key="k", default_model=models[0],
        fallback_models=models[1:], max_retries=3, send_models_chain=True,
        extra_body={"reasoning": {"enabled": False}, "provider": {"data_collection": "deny"}},
    ))
    p._client = httpx.AsyncClient(transport=httpx.MockTransport(fake(seen, stream=stream)))
    return p


MSG = [Message(role="user", content="hi")]


@pytest.mark.asyncio
async def test_rate_limits_are_retried_on_the_same_model():
    seen = []
    r = await provider(seen, ["flaky", "backup"]).chat(MSG)
    assert r.content == "fine"
    assert [b["model"] for b in seen] == ["flaky", "flaky", "flaky"]


@pytest.mark.asyncio
async def test_a_dead_model_falls_through_to_the_next():
    seen = []
    r = await provider(seen, ["dead", "backup"]).chat(MSG)
    assert r.content == "fine"
    assert [b["model"] for b in seen] == ["dead", "backup"], "a 400 is not retried"
    assert seen[0]["models"] == ["dead", "backup"] and seen[1]["models"] == ["backup"]
    for b in seen:
        assert b["reasoning"] == {"enabled": False}
        assert b["provider"]["data_collection"] == "deny"


@pytest.mark.asyncio
async def test_every_model_failing_raises():
    with pytest.raises(httpx.HTTPStatusError):
        await provider([], ["dead"]).chat(MSG)


@pytest.mark.asyncio
async def test_stream_retries_and_falls_back_before_output():
    seen = []
    out = [c async for c in provider(seen, ["dead", "flaky"], stream=True).stream_chat(MSG)]
    assert out == ["fine"]
    assert [b["model"] for b in seen] == ["dead", "flaky", "flaky", "flaky"]


@pytest.mark.asyncio
async def test_stream_tools_uses_the_chain():
    seen = []
    p = provider(seen, ["dead", "backup"], stream=True)
    events = [e async for e in p.stream_chat_tools(MSG, tools=[])]
    assert events[0] == {"type": "content", "text": "fine"}
    assert [b["model"] for b in seen] == ["dead", "backup"]


def test_retry_delay_honours_retry_after_and_caps():
    assert retry_delay(1, "0") == 0
    assert 0.375 <= retry_delay(1) <= 0.625
    assert retry_delay(10) <= providers.MAX_BACKOFF_SECONDS
    assert retry_delay(1, "120") == providers.MAX_BACKOFF_SECONDS


def test_model_chain_dedupes_and_prefers_the_request():
    p = LLMProvider(ProviderConfig(name="t", base_url="x", api_key="k", default_model="a",
                                   fallback_models=["b", "a", " "]))
    assert p.model_chain(None) == ["a", "b"]
    assert p.model_chain("c") == ["c", "a", "b"]
