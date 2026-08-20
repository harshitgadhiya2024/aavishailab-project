"""Org-bound HMAC service-token verification (same scheme as the other
services; separate secret)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from .config import settings


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


class AuthError(Exception):
    pass


def mint_token(org_id: str, ttl_seconds: int = 300, secret: str | None = None) -> str:
    payload = json.dumps(
        {"iss": "admin-api", "org_id": org_id, "exp": int(time.time()) + ttl_seconds},
        separators=(",", ":"),
    ).encode()
    sig = hmac.new((secret or settings.service_secret).encode(), payload, hashlib.sha256).digest()
    return f"v1.{_b64url_encode(payload)}.{_b64url_encode(sig)}"


def verify_token(authorization_header: str | None, expected_org_id: str) -> None:
    if not settings.require_auth:
        return
    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise AuthError("missing bearer token")
    parts = authorization_header[len("Bearer "):].strip().split(".")
    if len(parts) != 3 or parts[0] != "v1":
        raise AuthError("malformed token")
    try:
        payload_bytes = _b64url_decode(parts[1])
        provided_sig = _b64url_decode(parts[2])
    except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
        raise AuthError("undecodable token")
    expected = hmac.new(settings.service_secret.encode(), payload_bytes, hashlib.sha256).digest()
    if not hmac.compare_digest(provided_sig, expected):
        raise AuthError("bad signature")
    try:
        payload = json.loads(payload_bytes)
    except json.JSONDecodeError:
        raise AuthError("bad payload")
    if int(payload.get("exp", 0)) < int(time.time()):
        raise AuthError("token expired")
    if str(payload.get("org_id")) != str(expected_org_id):
        raise AuthError("token org mismatch")
