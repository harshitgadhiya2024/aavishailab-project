"""Service-to-service authentication.

admin-api mints a short-TTL, org-bound HMAC token and sends it as
`Authorization: Bearer <token>`. This service verifies the signature and
expiry and confirms the token's org matches the org the request claims to act
for — so a token minted for org A can never be replayed to scan for org B.

Token format (all base64url, no padding):  v1.<payload>.<sig>
  payload = json({"iss":"admin-api","org_id":"<uuid>","exp":<unix_seconds>})
  sig     = HMAC_SHA256(payload_bytes, service_secret)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from .config import settings


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


class AuthError(Exception):
    """Raised when a token is missing, malformed, expired, or org-mismatched."""


def mint_token(org_id: str, ttl_seconds: int = 300, secret: str | None = None) -> str:
    """Test/helper mirror of admin-api's minting — kept here so the pytest suite
    can generate valid tokens without standing up the Go service."""
    payload = json.dumps(
        {"iss": "admin-api", "org_id": org_id, "exp": int(time.time()) + ttl_seconds},
        separators=(",", ":"),
    ).encode()
    sig = hmac.new((secret or settings.service_secret).encode(), payload, hashlib.sha256).digest()
    return f"v1.{_b64url_encode(payload)}.{_b64url_encode(sig)}"


def verify_token(authorization_header: str | None, expected_org_id: str) -> None:
    """Raises AuthError unless the bearer token is valid AND bound to
    expected_org_id. Returns None on success."""
    if not settings.require_auth:
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

    # Tries the current secret, then — during a rotation window — the
    # previous one, so a token minted moments before admin-api picked up a
    # new secret doesn't fail every service that hasn't rotated yet. An
    # unset previous secret is skipped rather than treated as valid.
    candidates = [settings.service_secret]
    if settings.service_secret_previous:
        candidates.append(settings.service_secret_previous)

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
