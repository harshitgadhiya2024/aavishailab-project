"""Out-of-band connector adapters.

Each SaaS provider needs OAuth into the customer's tenant to enumerate files +
sharing state. That's a per-provider integration (tenant admin consent, API
scopes, pagination). This module defines the seam:

  • "manual" / "generic": the inventory is supplied directly in the request
    (what the dashboard uses, and what tests exercise) — fully working.
  • "google_workspace" / "m365" / "box": real adapters. They're stubbed to
    fail with a clear "needs OAuth credentials" message rather than pretending
    to work, so it's honest about what's configured. Wiring real credentials in
    is the only remaining step to make them live — the analyzer (oob.py) they
    feed is identical.
"""

from __future__ import annotations

from .oob import FileRecord


class ProviderError(Exception):
    pass


_REAL_PROVIDERS = {"google_workspace", "m365", "box"}


def fetch_inventory(provider: str, payload: dict) -> list[FileRecord]:
    provider = (provider or "manual").lower()
    if provider in ("manual", "generic"):
        records: list[FileRecord] = []
        for f in payload.get("files", []):
            records.append(FileRecord(
                name=str(f.get("name", "")),
                owner=str(f.get("owner", "")),
                share_type=str(f.get("share_type", "private")),
                external_domains=list(f.get("external_domains", []) or []),
            ))
        return records
    if provider in _REAL_PROVIDERS:
        raise ProviderError(
            f"{provider} out-of-band connector requires OAuth credentials for the "
            f"customer tenant (not configured). Supply an inventory via provider "
            f"'manual' to analyze in the meantime."
        )
    raise ProviderError(f"unknown provider: {provider}")
