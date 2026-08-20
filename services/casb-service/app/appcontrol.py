"""Inline CASB — app-control policy engine.

Decides allow / alert / block for a SaaS *activity* (upload, download, share,
post, login) on a given app, using the app's category / sanction status / risk
(as classified by shadowit-service). This is the inline-mode CASB: it runs on
traffic the proxy already sees, layering app-aware control on top of the DLP
and threat engines.

An org supplies its own ordered rules; if none match, a built-in default set
applies (conservative: stop data leaving to unsanctioned or personal-transfer
destinations, flag AI tools).
"""

from __future__ import annotations

from dataclasses import dataclass, field

ACTIVITIES = {"upload", "download", "share", "post", "login", "any"}


@dataclass
class Rule:
    # Match conditions (all present ones must match; omitted = wildcard).
    category: str | None = None
    app: str | None = None
    activity: str = "any"
    sanctioned: bool | None = None
    min_risk: int | None = None
    action: str = "alert"  # block | alert | allow
    name: str = ""

    def matches(self, req: "Request") -> bool:
        if self.category is not None and self.category != req.category:
            return False
        if self.app is not None and self.app.lower() != (req.app or "").lower():
            return False
        if self.activity != "any" and self.activity != req.activity:
            return False
        if self.sanctioned is not None and self.sanctioned != req.sanctioned:
            return False
        if self.min_risk is not None and req.risk_score < self.min_risk:
            return False
        return True


@dataclass
class Request:
    app: str = ""
    category: str = "unknown"
    activity: str = "any"
    sanctioned: bool = False
    risk_score: int = 0


@dataclass
class Decision:
    action: str
    reason: str
    matched_rule: str = ""


# Defaults, evaluated only after the org's own rules.
#
# These are deliberately not "block everything unreviewed". An app is
# unsanctioned simply because nobody has reviewed it yet, so blocking every
# upload to one would stop ordinary work on day one — before an admin has had
# any chance to sanction the tools the company actually uses. The defaults
# therefore block where the intent is unambiguous (personal file-transfer
# sites, high-risk unreviewed destinations) and alert everywhere else. An org
# that wants stricter enforcement adds its own rule, which wins over these.
DEFAULT_RULES = [
    Rule(category="file_transfer", activity="upload", action="block",
         name="Block uploads to personal file-transfer sites"),
    Rule(sanctioned=False, min_risk=60, activity="upload", action="block",
         name="Block uploads to high-risk unsanctioned apps"),
    Rule(sanctioned=False, activity="upload", action="alert",
         name="Alert on uploads to unsanctioned apps"),
    Rule(category="ai_tools", activity="upload", action="alert",
         name="Alert on uploads to AI tools"),
    Rule(category="ai_tools", activity="post", action="alert",
         name="Alert on data pasted into AI tools"),
    Rule(sanctioned=False, min_risk=60, activity="any", action="alert",
         name="Alert on high-risk unsanctioned app usage"),
]


def evaluate(req: Request, org_rules: list[Rule] | None = None) -> Decision:
    for rule in (org_rules or []) + DEFAULT_RULES:
        if rule.matches(req):
            return Decision(action=rule.action, reason=rule.name or "matched app-control rule",
                            matched_rule=rule.name)
    return Decision(action="allow", reason="no app-control rule matched")
