"""Out-of-band CASB — cloud data-at-rest share-risk analysis.

A real out-of-band connector authenticates to a SaaS tenant (Google Workspace,
Microsoft 365, Box, ...) via OAuth and enumerates files + their sharing state.
That per-provider OAuth fetching is an adapter concern (see `providers.py`);
THIS module is the provider-agnostic risk analyzer that takes a normalized file
inventory and flags the risky shares — public links, external shares of
sensitive documents, ownerless files. It's the reusable core every connector
feeds, and it's fully testable with a fixture inventory.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Filename hints that a document likely holds regulated / confidential data.
_SENSITIVE_HINTS = [
    "salary", "payroll", "confidential", "secret", "passport", "ssn", "aadhaar",
    "contract", "nda", "financial", "invoice", "bank", "credential", "password",
    "customer", "patient", "medical", "offer letter", "termination",
]
_SENSITIVE_RE = re.compile("|".join(re.escape(h) for h in _SENSITIVE_HINTS), re.IGNORECASE)


@dataclass
class FileRecord:
    name: str
    owner: str = ""
    # share_type: private | internal | external | public
    share_type: str = "private"
    external_domains: list[str] = field(default_factory=list)


@dataclass
class Finding:
    file: str
    severity: str  # high | medium | low
    issue: str
    recommendation: str

    def as_dict(self) -> dict:
        return {"file": self.file, "severity": self.severity, "issue": self.issue, "recommendation": self.recommendation}


def _is_sensitive(name: str) -> bool:
    return bool(_SENSITIVE_RE.search(name or ""))


def analyze_file(f: FileRecord) -> Finding | None:
    sensitive = _is_sensitive(f.name)
    st = (f.share_type or "private").lower()

    if st == "public":
        sev = "high" if sensitive else "medium"
        return Finding(f.name, sev,
                       "shared via a public link (anyone with the link can access)"
                       + (" and looks sensitive" if sensitive else ""),
                       "Revoke the public link; restrict to specific people")
    if st == "external":
        if sensitive:
            return Finding(f.name, "high",
                           f"sensitive document shared externally ({', '.join(f.external_domains) or 'external users'})",
                           "Review and remove external access; restrict to internal")
        return Finding(f.name, "medium",
                       f"shared with external domains ({', '.join(f.external_domains) or 'external users'})",
                       "Confirm the external sharing is intended")
    if st == "internal" and sensitive:
        return Finding(f.name, "low",
                       "sensitive document shared organization-wide",
                       "Consider restricting to a specific team")
    return None


@dataclass
class Report:
    findings: list[Finding]
    scanned: int
    counts: dict


def analyze(files: list[FileRecord]) -> Report:
    findings: list[Finding] = []
    for f in files:
        finding = analyze_file(f)
        if finding:
            findings.append(finding)
    # Most severe first.
    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda x: order.get(x.severity, 3))
    counts = {"high": 0, "medium": 0, "low": 0}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    return Report(findings=findings, scanned=len(files), counts=counts)
