"""
LLM access for the Aavishield AI service, through OpenRouter.

Resilience, outermost first:
  - a model chain per provider (default model, then OPENROUTER_FALLBACK_MODELS),
    tried in order until one answers;
  - each model retried on 408/425/429/5xx and network errors with exponential
    backoff, jitter and the server's Retry-After (LLM_MAX_RETRIES attempts);
  - the remaining chain is also sent to OpenRouter as `models`, so it can
    fail over upstream by itself.
A local Ollama can be added to LLM_PROVIDER_CHAIN as a further fallback.
"""

from __future__ import annotations

import asyncio
import os
import random
import time
import logging
from typing import AsyncIterator, Iterator
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)


@dataclass
class Message:
    role: str          # system | user | assistant | tool
    content: str
    tool_calls: list | None = None
    tool_call_id: str | None = None
    name: str | None = None

    def to_dict(self) -> dict:
        d = {"role": self.role, "content": self.content}
        if self.tool_calls:
            d["tool_calls"] = self.tool_calls
        if self.tool_call_id:
            d["tool_call_id"] = self.tool_call_id
        if self.name:
            d["name"] = self.name
        return d


@dataclass
class ChatResponse:
    content: str
    model: str
    provider: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    finish_reason: str = "stop"
    tool_calls: list | None = None


@dataclass
class ProviderConfig:
    name: str
    base_url: str
    api_key: str
    default_model: str
    timeout: int = 60
    # Attempts per model (1 = no retry).
    max_retries: int = 3
    enabled: bool = True
    # Tried in order after the requested/default model fails.
    fallback_models: list = field(default_factory=list)
    # Extra headers sent on every request (OpenRouter uses HTTP-Referer /
    # X-Title for its dashboard attribution; harmless elsewhere).
    extra_headers: dict = field(default_factory=dict)
    # Merged into every request body (OpenRouter routing/privacy options).
    extra_body: dict = field(default_factory=dict)
    # Send the remaining chain as `models` (an OpenRouter extension).
    send_models_chain: bool = False


RETRYABLE_STATUS = {408, 425, 429}
MAX_BACKOFF_SECONDS = 10.0


def is_retryable(status: int) -> bool:
    """Timeouts, rate limits and server errors; never auth/credit/bad-request."""
    return status in RETRYABLE_STATUS or 500 <= status < 600


def retry_delay(attempt: int, retry_after: str | None = None) -> float:
    """Seconds to wait before retry `attempt` (1-based): Retry-After when the
    server sent one, else 0.5s doubling; capped, with ±25% jitter."""
    base = None
    if retry_after:
        try:
            base = max(0.0, float(retry_after))
        except ValueError:
            base = None
    if base is None:
        base = 0.5 * (2 ** min(attempt - 1, 5))
    return min(base * random.uniform(0.75, 1.25), MAX_BACKOFF_SECONDS)


class RetryableError(Exception):
    """A transient failure worth another attempt on the same model."""


class LLMProvider:
    """OpenAI-compatible chat-completions client (OpenRouter, Ollama)."""

    def __init__(self, config: ProviderConfig):
        self.config = config
        self._client = httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
                **config.extra_headers,
            },
            timeout=httpx.Timeout(config.timeout),
        )

    def _completions_url(self, model: str | None = None) -> str:
        """Absolute URL for a chat-completions call against this provider."""
        return f"{self.config.base_url.rstrip('/')}/chat/completions"

    def model_chain(self, model: str | None) -> list[str]:
        """The requested model, then the default, then the fallbacks."""
        chain: list[str] = []
        for m in [model, self.config.default_model, *self.config.fallback_models]:
            m = (m or "").strip()
            if m and m not in chain:
                chain.append(m)
        return chain

    def _payload(self, chain: list[str], i: int, **fields) -> dict:
        payload = {"model": chain[i], **fields, **self.config.extra_body}
        if self.config.send_models_chain:
            payload["models"] = chain[i:]
        return payload

    async def _post_with_retries(self, payload: dict) -> dict:
        """POST one non-streaming completion, retrying transient failures."""
        last: Exception | None = None
        retry_after: str | None = None
        for attempt in range(max(1, self.config.max_retries)):
            if attempt:
                await asyncio.sleep(retry_delay(attempt, retry_after))
            retry_after = None
            try:
                resp = await self._client.post(self._completions_url(), json=payload)
            except (httpx.TransportError, httpx.TimeoutException) as e:
                last = e
                continue
            if is_retryable(resp.status_code):
                retry_after = resp.headers.get("retry-after")
                last = httpx.HTTPStatusError(f"{resp.status_code}", request=resp.request, response=resp)
                continue
            resp.raise_for_status()
            return resp.json()
        raise last or RuntimeError("no attempt made")

    @property
    def is_available(self) -> bool:
        return bool(self.config.api_key and self.config.enabled)

    async def chat(
        self,
        messages: list[Message],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        tools: list | None = None,
        tool_choice: str | None = None,
        stream: bool = False,
    ) -> ChatResponse:
        fields = {
            "messages": [m.to_dict() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if tools:
            fields["tools"] = tools
        if tool_choice:
            fields["tool_choice"] = tool_choice

        chain = self.model_chain(model)
        data, last = None, None
        for i in range(len(chain)):
            payload = self._payload(chain, i, **fields)
            try:
                data = await self._post_with_retries(payload)
                if i:
                    logger.info("LLM answered by fallback model %s (primary %s)", chain[i], chain[0])
                break
            except Exception as e:
                logger.warning("LLM model %s failed on %s: %s", chain[i], self.config.name, e)
                last = e
        if data is None:
            raise last or RuntimeError("no model configured")

        choice = data["choices"][0]
        msg = choice["message"]
        usage = data.get("usage", {})

        return ChatResponse(
            content=msg.get("content") or "",
            model=data.get("model", payload["model"]),
            provider=self.config.name,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            finish_reason=choice.get("finish_reason", "stop"),
            tool_calls=msg.get("tool_calls"),
        )

    async def stream_chat(
        self,
        messages: list[Message],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        import json

        fields = {
            "messages": [m.to_dict() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        async for line in self._stream_lines(fields, model):
            chunk = line[6:]
            if chunk == "[DONE]":
                break
            try:
                data = json.loads(chunk)
                delta = data["choices"][0]["delta"]
                if "content" in delta and delta["content"]:
                    yield delta["content"]
            except Exception:
                continue

    async def _stream_lines(self, fields: dict, model: str | None) -> AsyncIterator[str]:
        """SSE `data:` lines of one streamed completion. Retries and walks the
        model chain only while nothing has been yielded; once the answer has
        started streaming, a failure is raised to the caller."""
        chain = self.model_chain(model)
        last: Exception | None = None
        for i in range(len(chain)):
            payload = self._payload(chain, i, **fields)
            retry_after: str | None = None
            for attempt in range(max(1, self.config.max_retries)):
                if attempt:
                    await asyncio.sleep(retry_delay(attempt, retry_after))
                retry_after = None
                started = False
                try:
                    async with self._client.stream("POST", self._completions_url(), json=payload) as resp:
                        if resp.status_code >= 400:
                            body = (await resp.aread()).decode(errors="replace")[:300]
                            err = httpx.HTTPStatusError(f"{resp.status_code}: {body}", request=resp.request, response=resp)
                            if is_retryable(resp.status_code):
                                retry_after = resp.headers.get("retry-after")
                                raise RetryableError(str(err)) from err
                            raise err
                        async for line in resp.aiter_lines():
                            if line.startswith("data: "):
                                started = True
                                yield line
                    if i:
                        logger.info("LLM stream answered by fallback model %s (primary %s)", chain[i], chain[0])
                    return
                except (RetryableError, httpx.TransportError, httpx.TimeoutException) as e:
                    if started:
                        raise
                    last = e
                    continue
                except httpx.HTTPStatusError as e:
                    last = e
                    break  # permanent for this model: try the next one
            logger.warning("LLM model %s failed on %s: %s", chain[i], self.config.name, last)
        raise last or RuntimeError("no model configured")

    async def stream_chat_tools(
        self,
        messages: list[Message],
        tools: list,
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 2048,
    ) -> AsyncIterator[dict]:
        """Streams a tool-enabled completion.

        Yields {"type": "content", "text"} as text arrives, then, if the model
        decided to call tools, one {"type": "tool_calls", "tool_calls"} with the
        calls reassembled from their streamed fragments (OpenAI delta format).
        """
        import json

        fields = {
            "messages": [m.to_dict() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            "tools": tools,
            "tool_choice": "auto",
        }
        calls: dict[int, dict] = {}
        async for line in self._stream_lines(fields, model):
            chunk = line[6:].strip()
            if chunk == "[DONE]":
                break
            try:
                data = json.loads(chunk)
            except json.JSONDecodeError:
                continue
            if data.get("error"):
                raise RuntimeError(str(data["error"])[:300])
            for choice in data.get("choices") or []:
                delta = choice.get("delta") or {}
                if delta.get("content"):
                    yield {"type": "content", "text": delta["content"]}
                for tc in delta.get("tool_calls") or []:
                    c = calls.setdefault(tc.get("index", 0), {"id": "", "type": "function",
                                                              "function": {"name": "", "arguments": ""}})
                    if tc.get("id"):
                        c["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name"):
                        c["function"]["name"] += fn["name"]
                    if fn.get("arguments"):
                        c["function"]["arguments"] += fn["arguments"]
        if calls:
            out = []
            for i, c in sorted(calls.items()):
                if not c["id"]:
                    c["id"] = f"call_{i}"
                out.append(c)
            yield {"type": "tool_calls", "tool_calls": out}

    async def close(self):
        await self._client.aclose()


class MultiLLMRouter:
    """
    Routes LLM requests through a provider chain with automatic fallback.
    All API keys are loaded from environment variables — never hardcoded.
    """

    def __init__(self):
        self.providers: list[LLMProvider] = []
        self._load_providers()

    def _load_providers(self):
        """Load providers from environment variables."""
        # OpenRouter only by default; a local Ollama can be appended.
        provider_chain = os.getenv("LLM_PROVIDER_CHAIN", "openrouter").split(",")
        retries = int(os.getenv("LLM_MAX_RETRIES", "3"))
        fallbacks = [m.strip() for m in os.getenv(
            "OPENROUTER_FALLBACK_MODELS", "google/gemma-4-26b-a4b-it,google/gemini-3.1-flash-lite").split(",") if m.strip()]

        provider_configs = {
            "openrouter": ProviderConfig(
                name="openrouter",
                # Standard OpenAI-compatible surface: a single
                # {base}/chat/completions endpoint, model passed in the body.
                base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
                api_key=os.getenv("OPENROUTER_API_KEY", ""),
                # Chosen by evaluation (Oct 2026): best tool selection, fastest,
                # ~5x cheaper than Gemini 2.5 Flash; served by Mistral (EU).
                default_model=os.getenv("OPENROUTER_DEFAULT_MODEL", "mistralai/mistral-small-2603"),
                fallback_models=fallbacks,
                timeout=int(os.getenv("LLM_TIMEOUT_SECONDS", "60")),
                max_retries=retries,
                extra_headers={
                    "HTTP-Referer": os.getenv("OPENROUTER_REFERER", "https://aavishield.com"),
                    "X-Title": os.getenv("OPENROUTER_TITLE", "Aavishield"),
                },
                # No thinking tokens (answers stream immediately), and only
                # providers that neither retain nor train on prompts.
                extra_body={"reasoning": {"enabled": False},
                            "provider": {"data_collection": "deny", "allow_fallbacks": True}},
                send_models_chain=True,
            ),
            # Add more providers here — e.g. a local Ollama instance
            "ollama": ProviderConfig(
                name="ollama",
                base_url=os.getenv("OLLAMA_BASE_URL", "http://ollama:11434/v1"),
                api_key="ollama",  # Ollama doesn't need a real key
                default_model=os.getenv("OLLAMA_DEFAULT_MODEL", "llama3.2"),
                max_retries=retries,
                enabled=os.getenv("OLLAMA_ENABLED", "false").lower() == "true",
            ),
        }

        for provider_name in provider_chain:
            name = provider_name.strip()
            if name in provider_configs:
                config = provider_configs[name]
                if config.enabled and config.api_key:
                    self.providers.append(LLMProvider(config))
                    logger.info(f"LLM provider loaded: {name} ({config.default_model})")
                else:
                    logger.warning(f"LLM provider {name} skipped (not enabled or no API key)")

        if not self.providers:
            logger.error("No LLM providers configured! Set OPENROUTER_API_KEY in .env")

    async def chat(
        self,
        messages: list[Message],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        tools: list | None = None,
        tool_choice: str | None = None,
        preferred_provider: str | None = None,
    ) -> ChatResponse:
        """Try providers in order, fall back on error."""
        providers = self.providers
        if preferred_provider:
            providers = [p for p in providers if p.config.name == preferred_provider] + \
                        [p for p in providers if p.config.name != preferred_provider]

        last_error = None
        for provider in providers:
            try:
                return await provider.chat(
                    messages, model=model, temperature=temperature,
                    max_tokens=max_tokens, tools=tools, tool_choice=tool_choice,
                )
            except httpx.HTTPStatusError as e:
                logger.warning(f"Provider {provider.config.name} returned {e.response.status_code}: {e}")
                last_error = e
            except Exception as e:
                logger.warning(f"Provider {provider.config.name} failed: {e}")
                last_error = e

        raise RuntimeError(f"All LLM providers failed. Last error: {last_error}")

    async def stream_chat(
        self,
        messages: list[Message],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        """Stream from first available provider."""
        for provider in self.providers:
            try:
                async for chunk in provider.stream_chat(messages, model=model,
                    temperature=temperature, max_tokens=max_tokens):
                    yield chunk
                return
            except Exception as e:
                logger.warning(f"Stream provider {provider.config.name} failed: {e}")
                continue

    async def stream_chat_tools(self, messages: list[Message], tools: list, model: str | None = None,
                                temperature: float = 0.2, max_tokens: int = 2048) -> AsyncIterator[dict]:
        """Tool-enabled stream with provider fallback. Falls back only while
        nothing has been sent yet; a failure mid-answer is raised."""
        last_error: Exception | None = None
        for provider in self.providers:
            started = False
            try:
                async for ev in provider.stream_chat_tools(messages, tools, model=model,
                                                           temperature=temperature, max_tokens=max_tokens):
                    started = True
                    yield ev
                return
            except Exception as e:
                if started:
                    raise
                logger.warning(f"Stream provider {provider.config.name} failed: {e}")
                last_error = e
        raise RuntimeError(f"All LLM providers failed. Last error: {last_error}")

    def get_available_models(self) -> list[dict]:
        """List configured providers and their default models."""
        return [
            {
                "provider": p.config.name,
                "model": p.config.default_model,
                "available": p.is_available,
            }
            for p in self.providers
        ]

    async def close(self):
        for p in self.providers:
            await p.close()


# Singleton
_router: MultiLLMRouter | None = None

def get_router() -> MultiLLMRouter:
    global _router
    if _router is None:
        _router = MultiLLMRouter()
    return _router
