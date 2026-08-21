"""Env set here, before any `app.main` import, so pytest doesn't spend the
whole run retrying span exports against an unreachable Tempo collector."""

import os

os.environ.setdefault("OTEL_SDK_DISABLED", "true")
