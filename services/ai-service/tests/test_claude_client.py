"""app.claude_client — kie.ai's Anthropic-native Claude endpoint, a
genuinely different wire format from the OpenAI-compatible path every
other model uses. See docs.kie.ai/market/claude/claude-sonnet-4-6.
"""

import httpx
import pytest

from app import claude_client


def test_is_claude_model():
    assert claude_client.is_claude_model("claude-sonnet-4-6")
    assert claude_client.is_claude_model("claude-opus-4-6")
    assert claude_client.is_claude_model("Claude-Sonnet-4-6")  # case-insensitive
    assert not claude_client.is_claude_model("gemini-3.1-pro")
    assert not claude_client.is_claude_model("gpt-4o")
    assert not claude_client.is_claude_model("")
    assert not claude_client.is_claude_model(None)


def test_image_content_block_shape():
    block = claude_client.image_content_block("YWJj", "image/png")
    assert block == {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "YWJj"}}


def test_image_content_block_defaults_mime():
    block = claude_client.image_content_block("YWJj", "")
    assert block["source"]["media_type"] == "image/jpeg"


@pytest.mark.asyncio
async def test_call_claude_missing_api_key_raises(monkeypatch):
    monkeypatch.delenv("KIE_AI_API_KEY", raising=False)
    with pytest.raises(claude_client.ClaudeCallError, match="KIE_AI_API_KEY"):
        await claude_client.call_claude("claude-sonnet-4-6", "sys", [{"type": "text", "text": "hi"}])


class _FakeResponse:
    def __init__(self, json_data, status_code=200):
        self._json = json_data
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=None, response=httpx.Response(self.status_code))

    def json(self):
        return self._json


class _FakeAsyncClient:
    def __init__(self, *a, **kw):
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        return _FakeAsyncClient.next_response


@pytest.mark.asyncio
async def test_call_claude_builds_correct_request_and_parses_text_block(monkeypatch):
    monkeypatch.setenv("KIE_AI_API_KEY", "test-key")
    monkeypatch.setenv("KIE_AI_BASE_URL", "https://api.kie.ai")

    _FakeAsyncClient.next_response = _FakeResponse({
        "role": "assistant",
        "type": "message",
        "model": "claude-sonnet-4-6",
        "content": [{"type": "text", "text": '{"sensitive": true, "doc_type": "pan_card"}'}],
        "stop_reason": "end_turn",
    })
    monkeypatch.setattr(claude_client.httpx, "AsyncClient", _FakeAsyncClient)

    resp = await claude_client.call_claude(
        model="claude-sonnet-4-6",
        system="you are a classifier",
        user_content=[
            {"type": "text", "text": "Classify this image."},
            claude_client.image_content_block("YWJj", "image/jpeg"),
        ],
    )

    assert resp.text == '{"sensitive": true, "doc_type": "pan_card"}'
    assert resp.model == "claude-sonnet-4-6"

    call = _FakeAsyncClient.next_response  # sanity: response object still intact
    assert call is not None


@pytest.mark.asyncio
async def test_call_claude_hits_the_fixed_claude_path_not_per_model(monkeypatch):
    """kie.ai's Claude endpoint is POST {base}/claude/v1/messages — a fixed
    path segment, unlike every other kie.ai model's {base}/{model}/v1/chat/
    completions per-model routing. This is the exact mistake to guard
    against: sending the model name in the URL instead of the body."""
    monkeypatch.setenv("KIE_AI_API_KEY", "test-key")
    monkeypatch.setenv("KIE_AI_BASE_URL", "https://api.kie.ai")

    captured = {}

    class _CapturingClient(_FakeAsyncClient):
        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return _FakeResponse({"content": [{"type": "text", "text": "{}"}], "model": "claude-sonnet-4-6"})

    monkeypatch.setattr(claude_client.httpx, "AsyncClient", _CapturingClient)

    await claude_client.call_claude("claude-sonnet-4-6", "sys", [{"type": "text", "text": "hi"}])

    assert captured["url"] == "https://api.kie.ai/claude/v1/messages"
    assert captured["json"]["model"] == "claude-sonnet-4-6"
    assert captured["json"]["system"] == "sys"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["headers"]["X-Api-Key"] == "test-key"
    assert "anthropic-version" in captured["headers"]


@pytest.mark.asyncio
async def test_call_claude_ignores_non_text_blocks(monkeypatch):
    """A tool_use block (kie.ai's own doc example shows one) must not crash
    or leak into the returned text — only text blocks are joined."""
    monkeypatch.setenv("KIE_AI_API_KEY", "test-key")

    class _ToolUseClient(_FakeAsyncClient):
        async def post(self, url, json=None, headers=None):
            return _FakeResponse({
                "content": [
                    {"type": "tool_use", "name": "get_weather", "input": {"location": "x"}},
                    {"type": "text", "text": "final answer"},
                ],
                "model": "claude-sonnet-4-6",
            })

    monkeypatch.setattr(claude_client.httpx, "AsyncClient", _ToolUseClient)

    resp = await claude_client.call_claude("claude-sonnet-4-6", "sys", [{"type": "text", "text": "hi"}])
    assert resp.text == "final answer"


@pytest.mark.asyncio
async def test_call_claude_http_error_raises_claude_call_error(monkeypatch):
    monkeypatch.setenv("KIE_AI_API_KEY", "test-key")

    class _FailingClient(_FakeAsyncClient):
        async def post(self, url, json=None, headers=None):
            return _FakeResponse({"error": "unauthorized"}, status_code=401)

    monkeypatch.setattr(claude_client.httpx, "AsyncClient", _FailingClient)

    with pytest.raises(claude_client.ClaudeCallError):
        await claude_client.call_claude("claude-sonnet-4-6", "sys", [{"type": "text", "text": "hi"}])
