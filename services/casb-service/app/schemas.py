"""Request/response models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class RuleIn(BaseModel):
    name: str = ""
    category: str | None = None
    app: str | None = None
    activity: str = "any"
    sanctioned: bool | None = None
    min_risk: int | None = None
    action: str = "alert"


class AppControlRequest(BaseModel):
    org_id: str
    app: str = ""
    category: str = "unknown"
    activity: str = "any"
    sanctioned: bool = False
    risk_score: int = 0
    rules: list[RuleIn] = Field(default_factory=list)


class AppControlResponse(BaseModel):
    action: str
    reason: str
    matched_rule: str = ""


class FileIn(BaseModel):
    name: str
    owner: str = ""
    share_type: str = "private"
    external_domains: list[str] = Field(default_factory=list)


class OOBRequest(BaseModel):
    org_id: str
    provider: str = "manual"
    files: list[FileIn] = Field(default_factory=list)


class FindingOut(BaseModel):
    file: str
    severity: str
    issue: str
    recommendation: str


class OOBResponse(BaseModel):
    provider: str
    scanned: int
    counts: dict
    findings: list[FindingOut]
