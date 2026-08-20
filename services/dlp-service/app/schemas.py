"""Request/response models for the scan API."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class _NullTolerantLists(BaseModel):
    """Treat an explicit JSON null for a list/dict field as "not provided".

    A client that leaves a list empty may serialise it as null (Go marshals a
    nil slice that way). Rejecting that with a 422 is technically correct and
    practically awful: the caller reads the failure as "service unavailable"
    and silently downgrades to its fallback scanner, so DLP keeps "working"
    while quietly doing less.
    """

    @field_validator("*", mode="before")
    @classmethod
    def _null_to_default(cls, v, info):
        if v is None:
            field = cls.model_fields.get(info.field_name)
            if field is not None and field.default_factory is not None:
                return field.default_factory()
        return v


class CustomPatternIn(BaseModel):
    name: str = ""
    regex: str


class PolicyIn(_NullTolerantLists):
    name: str = ""
    # The policy's enforcement ceiling: block | alert | log | allow.
    action: str = "block"
    detectors: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    custom_patterns: list[CustomPatternIn] = Field(default_factory=list)
    bypass_file_types: list[str] = Field(default_factory=list)
    detector_weights: dict[str, int] = Field(default_factory=dict)
    block_threshold: int | None = None
    alert_threshold: int | None = None
    priority: int = 100


class ScanRequest(_NullTolerantLists):
    org_id: str
    filename: str = ""
    content_type: str = ""
    destination: str = ""
    # Exactly one of content_b64 / text is used. content_b64 is what admin-api
    # forwards (raw upload bytes, base64); text is the inline path the dashboard
    # "test a sample" tool uses.
    content_b64: str | None = None
    text: str | None = None
    policies: list[PolicyIn] = Field(default_factory=list)


class MatchOut(BaseModel):
    detector: str
    label: str
    masked_preview: str
    weight: int


class ScanResponse(BaseModel):
    scanned: bool = True
    matched: bool
    score: int
    band: str
    action: str
    policy_name: str = ""
    reason: str = ""
    detectors: list[str] = Field(default_factory=list)
    matches: list[MatchOut] = Field(default_factory=list)
    thresholds: dict[str, int] = Field(default_factory=dict)
