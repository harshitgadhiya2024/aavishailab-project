"""Runtime configuration, sourced from environment variables.

Every value has a safe default so the service boots in development without a
`.env`, but the auth secret default is intentionally insecure and MUST be
overridden in production (the service logs a warning when it detects the
default is still in use).
"""

from __future__ import annotations

import os


def _int(env: str, default: int) -> int:
    try:
        return int(os.getenv(env, str(default)))
    except (TypeError, ValueError):
        return default


class Settings:
    # Shared secret used to verify the HMAC service token minted by admin-api.
    # Both services must be given the SAME value.
    service_secret: str = os.getenv("DLP_SERVICE_SECRET", "dev-insecure-dlp-secret-change-me")

    # Reject requests whose (org-bound, short-TTL) token is missing/invalid.
    # Only ever turn off in isolated unit tests.
    require_auth: bool = os.getenv("DLP_REQUIRE_AUTH", "true").lower() == "true"

    # Largest content we will buffer + scan. Mirrors the agent's MAX_SCAN_SIZE
    # so the two ends agree on what "too big to scan" means.
    max_scan_size: int = _int("DLP_MAX_SCAN_SIZE", 20 * 1024 * 1024)

    # Default decision bands (per-org policy can override these).
    default_block_threshold: int = _int("DLP_BLOCK_THRESHOLD", 80)
    default_alert_threshold: int = _int("DLP_ALERT_THRESHOLD", 50)

    @property
    def using_default_secret(self) -> bool:
        return self.service_secret == "dev-insecure-dlp-secret-change-me"


settings = Settings()
