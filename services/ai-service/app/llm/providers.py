"""
Multi-LLM provider system for Aavishield AI service.
Primary: kie.ai (OpenAI-compatible API)
Fallback chain configurable via LLM_PROVIDER_CHAIN env var.
"""

from __future__ import annotations

import os
import time
import logging
from typing import AsyncIterator, Iterator
from dataclasses import dataclass, field

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

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
    max_retries: int = 3
    enabled: bool = True
    # kie.ai serves each model on its own path — https://api.kie.ai/{model}/v1/
    # chat/completions — rather than the single /v1/chat/completions endpoint
    # OpenAI uses. With "per_model" the model name is spliced into the URL.
    path_style: str = "openai"  # openai | per_model
    # Extra headers sent on every request (OpenRouter uses HTTP-Referer /
    # X-Title for its dashboard attribution; harmless elsewhere).
    extra_headers: dict = field(default_factory=dict)


class LLMProvider:
    """OpenAI-compatible LLM provider (works with kie.ai, openai, etc.)"""

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

    def _completions_url(self, model: str) -> str:
        """Absolute URL for a chat-completions call against this provider."""
        base = self.config.base_url.rstrip("/")
        if self.config.path_style == "per_model":
            return f"{base}/{model}/v1/chat/completions"
        return f"{base}/chat/completions"

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
        payload = {
            "model": model or self.config.default_model,
            "messages": [m.to_dict() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools
        if tool_choice:
            payload["tool_choice"] = tool_choice

        resp = await self._client.post(self._completions_url(payload["model"]), json=payload)
        resp.raise_for_status()
        data = resp.json()

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
        payload = {
            "model": model or self.config.default_model,
            "messages": [m.to_dict() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        async with self._client.stream("POST", self._completions_url(payload["model"]), json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    chunk = line[6:]
                    if chunk == "[DONE]":
                        break
                    try:
                        import json
                        data = json.loads(chunk)
                        delta = data["choices"][0]["delta"]
                        if "content" in delta and delta["content"]:
                            yield delta["content"]
                    except Exception:
                        continue

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
        # OpenRouter is the default primary now (DLP text/vision classification
        # runs through it); kie.ai stays on the chain as a fallback where a key
        # is still configured.
        provider_chain = os.getenv("LLM_PROVIDER_CHAIN", "openrouter,kie_ai").split(",")

        provider_configs = {
            "openrouter": ProviderConfig(
                name="openrouter",
                # Standard OpenAI-compatible surface: a single
                # {base}/chat/completions endpoint, model passed in the body.
                base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
                api_key=os.getenv("OPENROUTER_API_KEY", ""),
                default_model=os.getenv("OPENROUTER_DEFAULT_MODEL", "google/gemini-2.5-flash-lite"),
                timeout=int(os.getenv("LLM_TIMEOUT_SECONDS", "60")),
                path_style="openai",
                extra_headers={
                    "HTTP-Referer": os.getenv("OPENROUTER_REFERER", "https://aavishield.com"),
                    "X-Title": os.getenv("OPENROUTER_TITLE", "AaviShield DLP"),
                },
            ),
            "kie_ai": ProviderConfig(
                name="kie_ai",
                # Base is the host only: the model and /v1 are appended per call.
                base_url=os.getenv("KIE_AI_BASE_URL", "https://api.kie.ai"),
                api_key=os.getenv("KIE_AI_API_KEY", ""),
                # kie.ai serves Gemini for chat; it does not host gpt-* models,
                # and asking for one returns "Operation not found".
                default_model=os.getenv("KIE_AI_DEFAULT_MODEL", "gemini-2.5-flash"),
                timeout=int(os.getenv("LLM_TIMEOUT_SECONDS", "60")),
                path_style=os.getenv("KIE_AI_PATH_STYLE", "per_model"),
            ),
            # Add more providers here — e.g. a local Ollama instance
            "ollama": ProviderConfig(
                name="ollama",
                base_url=os.getenv("OLLAMA_BASE_URL", "http://ollama:11434/v1"),
                api_key="ollama",  # Ollama doesn't need a real key
                default_model=os.getenv("OLLAMA_DEFAULT_MODEL", "llama3.2"),
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
