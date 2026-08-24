"""AgentState is what the desktop UI renders, so its transitions are the
contract behind every visible state in the window and the floating bar.

The rules encoded here are product requirements, not implementation detail:
a device connects once (no disconnect), a refused reconnect is terminal and
must carry the server's own wording, and "paused" may only ever appear on a
personal device — the server forces company-owned hardware to "full", and
this must not be able to show otherwise."""

from conftest import agent


def test_starts_disconnected():
    s = agent.AgentState()
    assert s.snapshot()["state"] == "disconnected"


def test_connect_flow_reaches_connected():
    s = agent.AgentState()
    s.set_connecting()
    assert s.snapshot()["state"] == "connecting"
    s.set_connected(org_name="Aavishailab", employee_name="Harshit")
    snap = s.snapshot()
    assert snap["state"] == "connected"
    assert snap["org_name"] == "Aavishailab"
    assert snap["employee_name"] == "Harshit"


def test_blocked_carries_the_servers_message():
    # The UI shows this verbatim: it names the one action that resolves it,
    # and paraphrasing it would lose that.
    msg = ("Your device entry already exists so ask to company IT administrator "
           "to give permission to again connect")
    s = agent.AgentState()
    s.set_connecting()
    s.set_blocked(msg)
    snap = s.snapshot()
    assert snap["state"] == "blocked"
    assert snap["message"] == msg


def test_enforcement_can_pause_a_connected_device():
    s = agent.AgentState()
    s.set_connected()
    s.set_enforcement("paused", "Personal time")
    assert s.snapshot()["state"] == "paused"


def test_enforcement_resumes_back_to_connected():
    s = agent.AgentState()
    s.set_connected()
    s.set_enforcement("paused", "Personal time")
    s.set_enforcement("full", "")
    assert s.snapshot()["state"] == "connected"


def test_enforcement_never_overrides_blocked_or_disconnected():
    # A device that was refused enrollment has no enforcement state to show,
    # and a heartbeat arriving late must not paint it as connected/paused.
    for setup in (lambda s: s.set_blocked("refused"), lambda s: s.set_disconnected()):
        s = agent.AgentState()
        setup(s)
        before = s.snapshot()["state"]
        s.set_enforcement("paused", "Personal time")
        assert s.snapshot()["state"] == before


def test_uninstall_is_hidden_until_the_company_allows_it():
    s = agent.AgentState()
    assert s.snapshot()["uninstall_allowed"] is False
    s.set_org_info("Aavishailab", "Harshit", uninstall_allowed=True)
    assert s.snapshot()["uninstall_allowed"] is True


def test_uptime_only_shows_once_connected():
    s = agent.AgentState()
    assert s.snapshot()["uptime"] == ""
    s.set_connected()
    assert s.snapshot()["uptime"] == "0m"
