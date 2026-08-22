"""services/admin-api embeds a copy of this same file (go:embed can't reach
across the module boundary into scripts/agent/, so admin-api keeps its own
copy at internal/handlers/assets/aavishield-agent.py) to serve the
IT/unattended script-installer fallback. That copy has no automatic way to
stay current — it silently fell behind once already (missing an entire
security feature, policy-signature verification, plus later fixes) with
nothing to catch it. This test is that catch: it fails the moment the two
files diverge, so a future edit to the canonical agent can't ship without
either updating the embedded copy too or deliberately skipping this test."""

import filecmp
import os

_CANONICAL = os.path.join(os.path.dirname(__file__), "..", "aavishield-agent.py")
_EMBEDDED = os.path.join(
    os.path.dirname(__file__), "..", "..", "..",
    "services", "admin-api", "internal", "handlers", "assets", "aavishield-agent.py",
)


def test_embedded_copy_matches_canonical_agent():
    assert os.path.isfile(_EMBEDDED), (
        f"expected admin-api's embedded agent script at {_EMBEDDED} — "
        "has it moved?"
    )
    assert filecmp.cmp(_CANONICAL, _EMBEDDED, shallow=False), (
        f"{_EMBEDDED} has drifted from the canonical {_CANONICAL}. "
        "Copy the canonical file over the embedded one (they must be "
        "byte-identical) before merging."
    )
