"""The assistant is read-only, streams its answer, and turns report requests
into a download card. The LLM and the admin API are both faked here."""

import json

import httpx
import pytest

from app.core import agent as agent_mod
from app.core.agent import TOOLS, AssistantAgent
from app.llm.providers import LLMProvider, ProviderConfig


class FakeRouter:
    """Plays back one scripted stream per round."""

    def __init__(self, rounds):
        self.rounds = list(rounds)
        self.seen = []

    async def stream_chat_tools(self, messages, model=None, tools=None, **_):
        self.seen.append([m.to_dict() for m in messages])
        for ev in self.rounds.pop(0):
            yield ev


def call(name, args, cid="c1"):
    return {"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def make_agent(router, handler):
    a = AssistantAgent(org_id="org", org_name="Delphic", access_token="t",
                       admin_api_url="http://api", tz="Asia/Kolkata", router=router)
    a.executor.client = httpx.AsyncClient(transport=httpx.MockTransport(handler), headers={"Authorization": "Bearer t"})
    return a


async def collect(a, messages):
    return [e async for e in a.run(messages)]


def test_tool_set_is_read_only():
    names = {t["function"]["name"] for t in TOOLS}
    for verb in ("create", "update", "delete", "toggle", "resolve", "approve", "set_", "add_", "block"):
        assert not any(n.startswith(verb) for n in names), names


@pytest.mark.asyncio
async def test_answers_from_live_data_and_only_reads():
    methods = []

    def api(req: httpx.Request):
        methods.append(req.method)
        if req.url.path == "/api/v1/employees":
            assert req.url.params["search"] == "riya"
            return httpx.Response(200, json={"data": [{"id": "e1", "first_name": "Riya", "last_name": "Patel", "email": "r@d.in"}]})
        if req.url.path == "/api/v1/devices":
            return httpx.Response(200, json={"data": [{"hostname": "Riya-Mac", "status": "online",
                                                       "metadata": {"posture_failed": ["firewall"]}}]})
        return httpx.Response(404, json={"error": "nope"})

    router = FakeRouter([
        [{"type": "content", "text": "Let me check."},
         {"type": "tool_calls", "tool_calls": [call("find_employee", {"query": "riya"})]}],
        [{"type": "content", "text": "**Riya Patel**'s laptop "}, {"type": "content", "text": "`Riya-Mac` is online."}],
    ])
    a = make_agent(router, api)
    events = await collect(a, [
        {"role": "assistant", "content": "Hi! Ask me anything."},
        {"role": "tool", "content": "old tool chatter"},
        {"role": "user", "content": "Is Riya's device connected?"},
    ])
    await a.close()

    types = [e["type"] for e in events]
    # "riya" resolves to exactly one person, so quick-action chips are offered
    # between the answer and done.
    assert types == ["chunk", "reset", "status", "chunk", "chunk", "suggestions", "done"]
    assert "".join(e["content"] for e in events[3:5]) == "**Riya Patel**'s laptop `Riya-Mac` is online."
    assert set(methods) == {"GET"}
    # History reached the model without tool chatter, and the tool result was fed back.
    first_round = router.seen[0]
    assert [m["role"] for m in first_round] == ["system", "assistant", "user"]
    tool_msg = router.seen[1][-1]
    assert tool_msg["role"] == "tool" and "Riya-Mac" in tool_msg["content"] and "firewall" in tool_msg["content"]


@pytest.mark.asyncio
async def test_export_report_becomes_a_download_card():
    def api(req):
        assert req.url.path == "/api/v1/reports/dlp"
        assert req.url.params["employee_id"] == "e1" and req.url.params["start"] == "2026-09-01"
        return httpx.Response(200, json={"name": "Data protection", "total": 7,
                                         "period": {"employee_name": "Riya Patel"},
                                         "summary": [{"label": "Sensitive data incidents", "value": 7}]})

    router = FakeRouter([
        [{"type": "tool_calls", "tool_calls": [call("export_report", {
            "report_type": "dlp", "employee_id": "e1", "start": "2026-09-01", "end": "2026-09-30"})]}],
        [{"type": "content", "text": "Riya had **7** DLP incidents in September. Download it below."}],
    ])
    a = make_agent(router, api)
    events = await collect(a, [{"role": "user", "content": "Riya's DLP report for September"}])
    await a.close()
    att = next(e for e in events if e["type"] == "attachment")["report"]
    assert att["type"] == "dlp" and att["employee_name"] == "Riya Patel" and att["rows"] == 7
    assert att["start"] == "2026-09-01" and att["end"] == "2026-09-30" and att["tz"] == "Asia/Kolkata"


@pytest.mark.asyncio
async def test_permission_errors_are_explained():
    router = FakeRouter([
        [{"type": "tool_calls", "tool_calls": [call("list_devices", {})]}],
        [{"type": "content", "text": "You don't have access to devices."}],
    ])
    a = make_agent(router, lambda req: httpx.Response(403, json={"error": "forbidden"}))
    await collect(a, [{"role": "user", "content": "list devices"}])
    await a.close()
    assert "permission" in router.seen[1][-1]["content"]


@pytest.mark.asyncio
async def test_provider_reassembles_streamed_tool_calls():
    sse = "\n".join("data: " + json.dumps(d) for d in [
        {"choices": [{"delta": {"content": "Hi"}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_a", "function": {"name": "get_", "arguments": '{"con'}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"name": "incidents", "arguments": 'trol":"dlp"}'}}]}}]},
    ]) + "\ndata: [DONE]\n"
    p = LLMProvider(ProviderConfig(name="t", base_url="http://llm", api_key="k", default_model="m"))
    p._client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=sse)))
    events = [e async for e in p.stream_chat_tools([], tools=TOOLS)]
    assert events[0] == {"type": "content", "text": "Hi"}
    tc = events[1]["tool_calls"][0]
    assert tc["id"] == "call_a" and tc["function"]["name"] == "get_incidents"
    assert json.loads(tc["function"]["arguments"]) == {"control": "dlp"}


# ─── Case-insensitive / fuzzy employee lookup + quick actions ────────────────

_EMPLOYEES = [
    {"id": "e1", "first_name": "Harshit", "last_name": "Patel",
     "email": "harshit@acme.test", "department": "Engineering", "status": "active"},
    {"id": "e2", "first_name": "Riya", "last_name": "Shah",
     "email": "riya@acme.test", "department": "Sales", "status": "active"},
    {"id": "e3", "first_name": "Jay", "last_name": "Patel",
     "email": "jay@acme.test", "department": "Ops", "status": "active"},
]


def _emp_handler(search_is_case_insensitive=True):
    """Fakes /employees (substring search over 'first last') and /devices."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/devices":
            return httpx.Response(200, json={"data": [], "total": 0})
        if request.url.path == "/api/v1/employees":
            q = request.url.params.get("search", "")
            if not q:
                return httpx.Response(200, json={"data": _EMPLOYEES})
            needle = q.lower() if search_is_case_insensitive else q
            hits = []
            for e in _EMPLOYEES:
                full = f"{e['first_name']} {e['last_name']}"
                hay = full.lower() if search_is_case_insensitive else full
                if needle in hay or needle in e["email"]:
                    hits.append(e)
            return httpx.Response(200, json={"data": hits})
        return httpx.Response(200, json={})
    return handler


@pytest.mark.asyncio
async def test_find_employee_is_case_insensitive_and_focuses():
    router = FakeRouter([[{"type": "tool_calls", "tool_calls": [call("find_employee", {"query": "harshit patel"})]}],
                         [{"type": "content", "text": "Here is Harshit Patel."}]])
    a = make_agent(router, _emp_handler())
    events = await collect(a, [{"role": "user", "content": "harshit patel ka record dedo"}])
    # lower-case query still resolves the person
    assert a.executor.focused_employee == {"id": "e1", "name": "Harshit Patel"}
    # quick-action chips are offered for the resolved person
    sugg = [e for e in events if e.get("type") == "suggestions"]
    assert sugg and len(sugg[0]["items"]) == 2
    assert any("recent activity" in i["query"].lower() for i in sugg[0]["items"])
    assert any("report" in i["query"].lower() for i in sugg[0]["items"])


@pytest.mark.asyncio
async def test_find_employee_suggests_on_typo():
    # "harsh patel" matches nobody by substring, but should suggest Harshit Patel.
    out, _ = await _run_tool("find_employee", {"query": "harsh patel"})
    assert out["count"] == 0
    assert out.get("no_exact_match") is True
    names = [s["name"] for s in out["suggestions"]]
    assert "Harshit Patel" in names


async def _run_tool(name, args):
    from app.core.agent import ToolExecutor
    ex = ToolExecutor("http://api", "t", "UTC")
    ex.client = httpx.AsyncClient(transport=httpx.MockTransport(_emp_handler()), headers={"Authorization": "Bearer t"})
    try:
        return await ex.execute(name, args)
    finally:
        await ex.close()


@pytest.mark.asyncio
async def test_no_quick_actions_when_not_about_one_person():
    router = FakeRouter([[{"type": "content", "text": "You have 3 employees."}]])
    a = make_agent(router, _emp_handler())
    events = await collect(a, [{"role": "user", "content": "how many employees are there"}])
    assert not any(e.get("type") == "suggestions" for e in events)
