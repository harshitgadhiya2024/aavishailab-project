"""The block page an employee sees has to be their employer's page, and it
has to be safe to render.

A page carrying the security vendor's name reads like malware to the person
being blocked; one carrying their own company's name reads like policy. And
because it is served inside the blocked origin's own security context, every
value interpolated into it — the host from the network, the reason from
server-supplied policy text, the branding an admin typed — must be escaped.
"""

import pytest

from conftest import agent


@pytest.fixture(autouse=True)
def _clear_branding():
    """BRANDING is a process global; a test that sets it must not leak into
    the next one."""
    agent.BRANDING._data = {}
    yield
    agent.BRANDING._data = {}


def _brand(**kw):
    agent.BRANDING._data = kw


def test_renders_the_company_name_not_the_vendor_name():
    _brand(company_name="Acme Corp")
    html = agent.render_block_page("chatgpt.com", "Not approved", "AI tools").decode()
    assert "Blocked by Acme Corp" in html
    assert "Acme Corp security policy" in html
    assert "Aavishield" not in html


def test_falls_back_to_neutral_wording_before_branding_arrives():
    """An unreachable server must cost nothing visible — a half-branded page
    would be worse than a neutral one."""
    html = agent.render_block_page("chatgpt.com", "Not approved", "AI tools").decode()
    assert "Access blocked" in html
    assert "Your organization's security policy" in html
    assert "<img" not in html


def test_escapes_host_and_reason():
    html = agent.render_block_page(
        "evil.com/<script>alert(1)</script>",
        "<img src=x onerror=alert(2)>",
        'a"b',
    ).decode()
    assert "<script>alert(1)" not in html
    assert "<img src=x" not in html
    assert "&lt;script&gt;" in html


def test_escapes_company_supplied_branding_too():
    """An admin typing markup into the block-page message is the same risk as
    a hostile hostname, and is likelier."""
    _brand(company_name="Acme <b>Corp</b>",
           logo_url='https://x/"onerror="alert(1)',
           message="<script>bad()</script>")
    html = agent.render_block_page("x.com", "r", "c").decode()
    assert "<b>Corp</b>" not in html
    assert '"onerror="' not in html
    assert "<script>bad()" not in html


def test_logo_is_rendered_only_when_one_is_configured():
    _brand(company_name="Acme", logo_url="https://cdn.example.com/acme.png")
    assert "https://cdn.example.com/acme.png" in agent.render_block_page("x.com", "r", "c").decode()

    _brand(company_name="Acme")
    assert "<img" not in agent.render_block_page("x.com", "r", "c").decode()


def test_support_contact_becomes_a_mailto_only_when_it_is_an_address():
    _brand(support_contact="it@acme.com")
    assert "mailto:it@acme.com" in agent.render_block_page("x.com", "r", "c").decode()

    _brand(support_contact="Ask the IT desk on floor 3")
    html = agent.render_block_page("x.com", "r", "c").decode()
    assert "mailto:" not in html
    assert "Ask the IT desk on floor 3" in html


def test_custom_message_replaces_the_generic_closing_line():
    _brand(message="Raise a ticket in ServiceNow.")
    html = agent.render_block_page("x.com", "r", "c").decode()
    assert "Raise a ticket in ServiceNow." in html
    assert "contact your IT administrator" not in html


def test_a_garbage_branding_payload_does_not_break_the_page():
    """The server could return nulls or wrong types after a bad edit; the
    page still has to render, because the alternative is the employee seeing
    a raw connection error with no explanation at all."""
    _brand(company_name=None, logo_url=None, message=None, support_contact=None)
    html = agent.render_block_page("x.com", "reason", "cat").decode()
    assert "Access blocked" in html
    assert "reason" in html
