"""Runtime configuration from environment variables."""

from __future__ import annotations

import os


class Settings:
    service_secret: str = os.getenv("CASB_SERVICE_SECRET", "dev-insecure-casb-secret-change-me")
    require_auth: bool = os.getenv("CASB_REQUIRE_AUTH", "true").lower() == "true"

    @property
    def using_default_secret(self) -> bool:
        return self.service_secret == "dev-insecure-casb-secret-change-me"


settings = Settings()
