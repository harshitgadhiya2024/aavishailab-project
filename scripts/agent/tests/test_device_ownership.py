"""Device ownership drives two visible behaviours, and getting either wrong
in the "unknown" direction is a security hole rather than a cosmetic bug:

  * a personal device offers the employee a Disconnect control;
  * a company device does not, and is enforced around the clock.

Everything here is about what happens when the answer is *not* a clean
"personal" — an older server, the first paint before a heartbeat lands, a
corrupt value — because that is where a wrong default actually costs
something.
"""

from conftest import agent


def test_ownership_starts_as_company_before_any_heartbeat():
    """The connector paints before the first heartbeat returns. If that first
    frame said "personal", a company laptop would briefly show Disconnect."""
    state = agent.AgentState()
    assert state.snapshot()["ownership"] == "company"


def test_explicit_personal_is_honoured():
    state = agent.AgentState()
    state.set_ownership("personal")
    assert state.snapshot()["ownership"] == "personal"


def test_company_can_be_set_back_after_personal():
    """Reclassifying a device the other way has to take effect too —
    otherwise a device marked personal once keeps Disconnect forever."""
    state = agent.AgentState()
    state.set_ownership("personal")
    state.set_ownership("company")
    assert state.snapshot()["ownership"] == "company"


def test_anything_unrecognised_falls_back_to_company():
    """Only an exact "personal" unlocks Disconnect. An absent field (older
    server), an empty string, a casing variant or a corrupt value must all
    resolve to the stricter answer."""
    for value in (None, "", "   ", "Personal", "PERSONAL", "unknown", "corp", 0, []):
        state = agent.AgentState()
        state.set_ownership(value)
        assert state.snapshot()["ownership"] == "company", f"{value!r} unlocked Disconnect"


def test_ownership_survives_other_state_changes():
    """set_org_info and the connection-state setters share one lock and one
    attribute bag; a later write must not quietly clear ownership."""
    state = agent.AgentState()
    state.set_ownership("personal")
    state.set_org_info("Acme", "Priya", True)
    state.set_connected(org_name="Acme", employee_name="Priya")
    assert state.snapshot()["ownership"] == "personal"
