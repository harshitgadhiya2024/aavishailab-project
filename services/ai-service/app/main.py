"""Aavishield AI Service — FastAPI app"""

import json
import logging
import os
from typing import Any

import time

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from app import internal_auth, transcribe, text_classify, vision
from app.core.agent import AavishieldAgent
from app.llm.providers import Message, get_router
from app.tracing import setup_tracing

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Aavishield AI Service", version="1.0.0")
setup_tracing(app, "ai-service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_METRICS = {"requests_total": 0, "errors_total": 0, "chat_requests_total": 0}


@app.middleware("http")
async def _track_metrics(request: Request, call_next):
    _METRICS["requests_total"] += 1
    if request.url.path.startswith("/api/v1/chat"):
        _METRICS["chat_requests_total"] += 1
    start = time.monotonic()
    response = await call_next(request)
    if response.status_code >= 500:
        _METRICS["errors_total"] += 1
    response.headers["X-Response-Time-Ms"] = f"{(time.monotonic() - start) * 1000:.1f}"
    return response


@app.get("/metrics")
async def metrics() -> PlainTextResponse:
    lines = [f"ai_service_{k} {v}" for k, v in _METRICS.items()]
    return PlainTextResponse("\n".join(lines) + "\n")

ADMIN_API_URL = os.getenv("ADMIN_API_URL", "http://admin-api:6000")


def _provider_error_message(exc: Exception) -> str:
    """A message an admin can act on, rather than a stack trace.

    Every provider failing almost always means configuration — a wrong base URL,
    an expired key, or a model name the provider doesn't serve — so say that
    plainly instead of returning "Internal Server Error".
    """
    detail = str(exc)
    if "All LLM providers failed" in detail or "404" in detail or "Operation not found" in detail:
        return (
            "The AI assistant can't reach a working language model. This is a service "
            "configuration issue, not a problem with your request — check OPENROUTER_API_KEY "
            "and OPENROUTER_DEFAULT_MODEL (or the KIE_AI_* / OLLAMA_* fallback) for the "
            f"AI service. Provider said: {detail[:200]}"
        )
    return f"The AI assistant failed to answer: {detail[:300]}"


# ─── Models ───────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str
    tool_calls: list | None = None
    tool_call_id: str | None = None
    name: str | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str | None = None
    temperature: float = 0.7
    max_tokens: int = 2048
    stream: bool = False
    # Agent mode (with tools)
    agent_mode: bool = True
    org_name: str = "Your Organization"


class ModelInfo(BaseModel):
    provider: str
    model: str
    available: bool


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    router = get_router()
    return {
        "status": "healthy",
        "service": "ai-service",
        "providers": router.get_available_models(),
    }


# ─── DLP vision classification (internal, service-to-service) ────────────────

class ClassifyImageRequest(BaseModel):
    org_id: str
    image_b64: str
    mime: str = "image/jpeg"


@app.post("/v1/dlp/classify-image")
async def classify_image_endpoint(req: ClassifyImageRequest, authorization: str = Header(...)):
    """Internal endpoint admin-api calls (via a new ai-service client, HMAC-
    authed the same way as dlp-service/extract-service) for an image
    extract-service flagged as worth a closer look. See app/vision.py for
    the full rationale, cost controls, and failure-mode handling."""
    try:
        internal_auth.verify_token(authorization, req.org_id)
    except internal_auth.AuthError as exc:
        _METRICS["errors_total"] += 1
        raise HTTPException(status_code=401, detail=str(exc))

    verdict = await vision.classify_image(req.org_id, req.image_b64, req.mime)
    _METRICS["vision_classify_requests_total"] = _METRICS.get("vision_classify_requests_total", 0) + 1
    return verdict.to_dict()


class ClassifyTextRequest(BaseModel):
    org_id: str
    text: str


@app.post("/v1/dlp/classify-text")
async def classify_text_endpoint(req: ClassifyTextRequest, authorization: str = Header(...)):
    """Internal endpoint admin-api calls (HMAC-authed like classify-image)
    for a chunk of text extract-service pulled out of an upload, to decide
    whether it is semantically sensitive company data. See
    app/text_classify.py for cost controls and failure-mode handling."""
    try:
        internal_auth.verify_token(authorization, req.org_id)
    except internal_auth.AuthError as exc:
        _METRICS["errors_total"] += 1
        raise HTTPException(status_code=401, detail=str(exc))

    verdict = await text_classify.classify_text(req.org_id, req.text)
    _METRICS["text_classify_requests_total"] = _METRICS.get("text_classify_requests_total", 0) + 1
    return verdict.to_dict()


class TranscribeRequest(BaseModel):
    org_id: str
    audio_b64: str
    mime: str = "audio/mpeg"


@app.post("/v1/dlp/transcribe")
async def transcribe_endpoint(req: TranscribeRequest, authorization: str = Header(...)):
    """Internal endpoint: best-effort speech-to-text for an audio/video
    segment so its spoken content can flow through the same DLP detectors
    as any other text. Fails soft to an empty transcript (caller then
    records the part as unscannable). See app/transcribe.py."""
    try:
        internal_auth.verify_token(authorization, req.org_id)
    except internal_auth.AuthError as exc:
        _METRICS["errors_total"] += 1
        raise HTTPException(status_code=401, detail=str(exc))

    result = await transcribe.transcribe(req.org_id, req.audio_b64, req.mime)
    _METRICS["transcribe_requests_total"] = _METRICS.get("transcribe_requests_total", 0) + 1
    return result


# ─── Chat (non-streaming) ─────────────────────────────────────────────────────

@app.post("/api/v1/chat")
async def chat(
    req: ChatRequest,
    authorization: str = Header(...),
    x_org_id: str = Header(..., alias="x-org-id"),
):
    """Non-streaming chat with optional agent mode."""
    token = authorization.replace("Bearer ", "")

    messages = [m.model_dump(exclude_none=True) for m in req.messages]

    if req.agent_mode:
        agent = AavishieldAgent(
            org_id=x_org_id,
            org_name=req.org_name,
            access_token=token,
            admin_api_url=ADMIN_API_URL,
        )
        try:
            events = []
            async for event in agent.run(messages, model=req.model):
                events.append(event)
            return {"events": events}
        except Exception as exc:
            logger.exception("Agent run failed")
            raise HTTPException(status_code=502, detail=_provider_error_message(exc))
        finally:
            await agent.close()
    else:
        router = get_router()
        msgs = [Message(**m) for m in messages]
        try:
            resp = await router.chat(msgs, model=req.model, temperature=req.temperature, max_tokens=req.max_tokens)
        except Exception as exc:
            logger.exception("Chat failed")
            raise HTTPException(status_code=502, detail=_provider_error_message(exc))
        return {
            "content": resp.content,
            "model": resp.model,
            "provider": resp.provider,
            "usage": {
                "prompt_tokens": resp.prompt_tokens,
                "completion_tokens": resp.completion_tokens,
            }
        }


# ─── Chat (streaming SSE) ──────────────────────────────────────────────────────

@app.post("/api/v1/chat/stream")
async def chat_stream(
    req: ChatRequest,
    authorization: str = Header(...),
    x_org_id: str = Header(..., alias="x-org-id"),
):
    """Streaming chat with SSE. Agent mode sends structured events; simple mode streams tokens."""
    token = authorization.replace("Bearer ", "")
    messages = [m.model_dump(exclude_none=True) for m in req.messages]

    async def agent_stream():
        agent = AavishieldAgent(
            org_id=x_org_id,
            org_name=req.org_name,
            access_token=token,
            admin_api_url=ADMIN_API_URL,
        )
        try:
            async for event in agent.run(messages, model=req.model):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            # The stream has already begun, so an exception here would just cut
            # the connection and surface in the browser as an unexplained
            # network error. Send the reason as a normal event instead.
            logger.exception("Agent run failed")
            yield f"data: {json.dumps({'type': 'error', 'content': _provider_error_message(exc)})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        finally:
            await agent.close()

    async def simple_stream_guarded():
        try:
            async for chunk in simple_stream():
                yield chunk
        except Exception as exc:
            logger.exception("Chat stream failed")
            yield f"data: {json.dumps({'type': 'error', 'content': _provider_error_message(exc)})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    async def simple_stream():
        router = get_router()
        msgs = [Message(**m) for m in messages]
        async for chunk in router.stream_chat(msgs, model=req.model, temperature=req.temperature):
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    gen = agent_stream() if req.agent_mode else simple_stream_guarded()
    return StreamingResponse(gen, media_type="text/event-stream")


# ─── Models ───────────────────────────────────────────────────────────────────

@app.get("/api/v1/models")
async def list_models():
    router = get_router()
    return {"models": router.get_available_models()}


# ─── Completions (OpenAI-compatible proxy to kie.ai) ──────────────────────────

@app.post("/api/v1/completions")
async def completions(
    req: dict,
    authorization: str = Header(...),
):
    """OpenAI-compatible completion proxy through kie.ai."""
    token = authorization.replace("Bearer ", "")
    router = get_router()

    messages_raw = req.get("messages", [])
    msgs = [Message(**m) for m in messages_raw]

    resp = await router.chat(
        msgs,
        model=req.get("model"),
        temperature=req.get("temperature", 0.7),
        max_tokens=req.get("max_tokens", 2048),
    )

    return {
        "choices": [{
            "message": {"role": "assistant", "content": resp.content},
            "finish_reason": resp.finish_reason,
        }],
        "model": resp.model,
        "usage": {
            "prompt_tokens": resp.prompt_tokens,
            "completion_tokens": resp.completion_tokens,
            "total_tokens": resp.prompt_tokens + resp.completion_tokens,
        }
    }
