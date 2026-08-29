"""Service-to-service authentication for admin-api -> ai-service internal
calls (currently just /v1/dlp/classify-image). Byte-for-byte the same
HMAC bearer-token scheme dlp-service and extract-service use — admin-api
mints one token format and every internal microservice verifies it the
same way.

This is deliberately separate from the user-facing chat endpoints'
Authorization header, which carries a forwarded end-user JWT, not this
service token — the two must never be confused.

Token format (all base64url, no padding): v1.<payload>.<sig>
  payload = json({"iss":"admin-api","org_id":"<uuid>","exp":<unix_seconds>})
  sig     = HMAC_SHA256(payload_bytes, service_secret)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time


class AuthError(Exception):
    """Raised when a token is missing, malformed, expired, or org-mismatched."""


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _secret() -> str:
    return os.getenv("AI_SERVICE_INTERNAL_SECRET", "dev-insecure-ai-internal-secret-change-me")


def _secret_previous() -> str:
    return os.getenv("AI_SERVICE_INTERNAL_SECRET_PREVIOUS", "")


def require_auth() -> bool:
    return os.getenv("AI_INTERNAL_REQUIRE_AUTH", "true").lower() == "true"


def mint_token(org_id: str, ttl_seconds: int = 300, secret: str | None = None) -> str:
    """Test/helper mirror of admin-api's minting."""
    payload = json.dumps(
        {"iss": "admin-api", "org_id": org_id, "exp": int(time.time()) + ttl_seconds},
        separators=(",", ":"),
    ).encode()
    sig = hmac.new((secret or _secret()).encode(), payload, hashlib.sha256).digest()
    return f"v1.{_b64url_encode(payload)}.{_b64url_encode(sig)}"


def verify_token(authorization_header: str | None, expected_org_id: str) -> None:
    """Raises AuthError unless the bearer token is valid AND bound to
    expected_org_id. Returns None on success."""
    if not require_auth():
        return

    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise AuthError("missing bearer token")
    token = authorization_header[len("Bearer "):].strip()

    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "v1":
        raise AuthError("malformed token")

    _, payload_b64, sig_b64 = parts
    try:
        payload_bytes = _b64url_decode(payload_b64)
        provided_sig = _b64url_decode(sig_b64)
    except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
        raise AuthError("undecodable token")

    candidates = [_secret()]
    if _secret_previous():
        candidates.append(_secret_previous())

    if not any(
        hmac.compare_digest(provided_sig, hmac.new(secret.encode(), payload_bytes, hashlib.sha256).digest())
        for secret in candidates
    ):
        raise AuthError("bad signature")

    try:
        payload = json.loads(payload_bytes)
    except json.JSONDecodeError:
        raise AuthError("bad payload")

    if int(payload.get("exp", 0)) < int(time.time()):
        raise AuthError("token expired")

    if str(payload.get("org_id")) != str(expected_org_id):
        raise AuthError("token org mismatch")
