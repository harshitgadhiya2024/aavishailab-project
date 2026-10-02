"""Checks the admin-api access token on every AI request.

The dashboards call this service straight from the browser with the user's
admin-api JWT, and the service is reachable from the internet, so a request
without a valid token must never reach the LLM — otherwise anyone can spend
the OpenRouter credits. The token is HS256 over JWT_ACCESS_SECRET, which this
service shares with admin-api through .env; verifying it locally keeps the
check off the request path's latency.
"""

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass

from fastapi import Header, HTTPException

# admin-api's own fallback when JWT_ACCESS_SECRET is unset (auth/jwt.go), so a
# zero-setup local stack still works. Refused in production.
_DEV_SECRET = "aavishield-access-secret-change-in-production"

# Dashboard users' access tokens. Employee-portal ("aavishield-portal") and
# MFA-challenge ("aavishield-mfa") tokens are signed with the same secret but
# must not unlock the assistant.
_ISSUER = "aavishield"


@dataclass
class User:
    token: str
    claims: dict

    @property
    def org_id(self):
        return self.claims.get("org_id")

    @property
    def role(self):
        return self.claims.get("role")


def access_secret() -> str:
    secret = os.getenv("JWT_ACCESS_SECRET", "")
    if secret:
        return secret
    if os.getenv("APP_ENV") == "production":
        raise RuntimeError("JWT_ACCESS_SECRET must be set in production")
    return _DEV_SECRET


def _b64decode(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def verify_access_token(token: str, secret: str, now: float | None = None) -> dict:
    """Returns the token's claims, or raises ValueError."""
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        header = json.loads(_b64decode(header_b64))
        claims = json.loads(_b64decode(payload_b64))
        sig = _b64decode(sig_b64)
    except Exception:
        raise ValueError("malformed token")
    if header.get("alg") != "HS256":
        raise ValueError("unexpected algorithm")
    expected = hmac.new(secret.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected):
        raise ValueError("bad signature")
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or exp <= (now if now is not None else time.time()):
        raise ValueError("token expired")
    if claims.get("iss") != _ISSUER or not claims.get("role"):
        raise ValueError("not a dashboard access token")
    return claims


def require_user(authorization: str = Header(default="")) -> User:
    """FastAPI dependency: the caller's verified admin-api session."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        claims = verify_access_token(token, access_secret())
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return User(token=token, claims=claims)


def require_org(user: User, org_id: str) -> None:
    """A token only speaks for its own org; a superadmin may act on any."""
    if user.role == "superadmin":
        return
    if not user.org_id or user.org_id != org_id:
        raise HTTPException(status_code=403, detail="Token does not belong to this organization")
