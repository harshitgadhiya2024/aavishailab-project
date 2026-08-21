"""Runtime configuration from environment variables."""

from __future__ import annotations

import os


class Settings:
    service_secret: str = os.getenv("CASB_SERVICE_SECRET", "dev-insecure-casb-secret-change-me")

    # Optional, only set during a secret rotation window — tokens signed with
    # either secret verify while this is set, so admin-api and this service
    # can be restarted independently without a window where every request 401s.
    service_secret_previous: str = os.getenv("CASB_SERVICE_SECRET_PREVIOUS", "")
    require_auth: bool = os.getenv("CASB_REQUIRE_AUTH", "true").lower() == "true"

    @property
    def using_default_secret(self) -> bool:
        return self.service_secret == "dev-insecure-casb-secret-change-me"


settings = Settings()
