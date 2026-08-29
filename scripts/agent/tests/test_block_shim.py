"""In-page block-notice shim — the mechanism that lets a Gmail/Slack/Teams/
Outlook-web upload actually show the real block reason instead of a generic
"Upload failed" (see BLOCK_PAGE_HTML's docstring / the module comment above
_BLOCK_SHIM_JS in aavishield-agent.py for the full rationale)."""

import base64
import gzip
import hashlib

from conftest import agent


# ─── _is_document_request ──────────────────────────────────────────────────

def test_document_request_via_sec_fetch_dest():
    headers = b"GET / HTTP/1.1\r\nHost: example.com\r\nSec-Fetch-Dest: document\r\n\r\n"
    assert agent._is_document_request(headers) is True


def test_non_document_via_sec_fetch_dest():
    headers = b"GET /api/data HTTP/1.1\r\nHost: example.com\r\nSec-Fetch-Dest: empty\r\n\r\n"
    assert agent._is_document_request(headers) is False


def test_document_fallback_via_accept_header():
    headers = b"GET / HTTP/1.1\r\nHost: example.com\r\nAccept: text/html,application/xhtml+xml\r\n\r\n"
    assert agent._is_document_request(headers) is True


def test_non_document_fallback_via_accept_header():
    headers = b"GET /style.css HTTP/1.1\r\nHost: example.com\r\nAccept: text/css\r\n\r\n"
    assert agent._is_document_request(headers) is False


def test_no_hints_defaults_false():
    headers = b"GET /x HTTP/1.1\r\nHost: example.com\r\n\r\n"
    assert agent._is_document_request(headers) is False


# ─── _response_is_html ──────────────────────────────────────────────────────

def test_response_is_html_true():
    headers = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
    assert agent._response_is_html(headers) is True


def test_response_is_html_false_for_json():
    headers = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n"
    assert agent._response_is_html(headers) is False


# ─── _strip_unsupported_encodings ──────────────────────────────────────────

def test_strips_brotli_keeps_gzip():
    headers = b"GET / HTTP/1.1\r\nAccept-Encoding: gzip, deflate, br, zstd\r\n\r\n"
    out = agent._strip_unsupported_encodings(headers)
    assert b"br" not in out
    assert b"zstd" not in out
    assert b"gzip" in out
    assert b"deflate" in out


def test_drops_header_entirely_when_only_brotli_offered():
    headers = b"GET / HTTP/1.1\r\nAccept-Encoding: br\r\n\r\n"
    out = agent._strip_unsupported_encodings(headers)
    assert b"accept-encoding" not in out.lower()


def test_no_accept_encoding_header_unchanged():
    headers = b"GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"
    assert agent._strip_unsupported_encodings(headers) == headers


# ─── _header_safe ───────────────────────────────────────────────────────────

def test_header_safe_strips_crlf_injection():
    malicious = "ok\r\nX-Injected: evil"
    safe = agent._header_safe(malicious)
    assert "\r" not in safe
    assert "\n" not in safe


def test_header_safe_truncates():
    long_value = "x" * 1000
    assert len(agent._header_safe(long_value, max_len=100)) == 100


# ─── shim tag / hash consistency ───────────────────────────────────────────

def test_shim_tag_contains_marker():
    assert agent._SHIM_MARKER in agent._shim_script_tag()


def test_shim_csp_hash_matches_script_content():
    """The CSP hash-source must cover exactly the bytes between <script...>
    and </script> — if the tag-building and hash-computing code ever drift
    apart, every site with a hash-based CSP breaks silently."""
    tag = agent._shim_script_tag()
    inner = tag.split(b">", 1)[1].rsplit(b"</script>", 1)[0]
    expected_hash = "sha256-" + base64.b64encode(hashlib.sha256(inner).digest()).decode("ascii")
    assert agent._shim_csp_hash() == expected_hash


# ─── _rewrite_csp_headers ───────────────────────────────────────────────────

def test_csp_hash_appended_to_existing_script_src():
    headers = b"HTTP/1.1 200 OK\r\nContent-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com\r\n\r\n"
    out = agent._rewrite_csp_headers(headers)
    csp_line = [l for l in out.split(b"\r\n") if l.lower().startswith(b"content-security-policy:")][0]
    assert agent._shim_csp_hash().encode() in csp_line
    assert b"https://cdn.example.com" in csp_line  # original sources preserved


def test_csp_falls_back_to_default_src_sources_not_bare_self():
    headers = b"HTTP/1.1 200 OK\r\nContent-Security-Policy: default-src 'self' https://cdn.example.com\r\n\r\n"
    out = agent._rewrite_csp_headers(headers)
    csp_line = [l for l in out.split(b"\r\n") if l.lower().startswith(b"content-security-policy:")][0]
    assert b"script-src" in csp_line
    # Must include default-src's own sources, not just 'self' — otherwise
    # this would narrow (break) whatever scripts default-src already allowed.
    assert b"https://cdn.example.com" in csp_line
    assert agent._shim_csp_hash().encode() in csp_line


def test_csp_with_neither_script_src_nor_default_src_left_untouched():
    headers = b"HTTP/1.1 200 OK\r\nContent-Security-Policy: img-src 'self'\r\n\r\n"
    out = agent._rewrite_csp_headers(headers)
    # Must NOT invent a new script-src restriction where none existed.
    assert b"script-src" not in out.lower()
    assert out == headers


def test_csp_report_only_also_rewritten():
    headers = b"HTTP/1.1 200 OK\r\nContent-Security-Policy-Report-Only: script-src 'self'\r\n\r\n"
    out = agent._rewrite_csp_headers(headers)
    assert agent._shim_csp_hash().encode() in out


def test_non_csp_headers_untouched():
    headers = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nX-Frame-Options: DENY\r\n\r\n"
    assert agent._rewrite_csp_headers(headers) == headers


# ─── _inject_block_shim (the end-to-end pure function) ─────────────────────

def test_injects_before_head_close():
    headers = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 999\r\n\r\n"
    body = b"<html><head><title>x</title></head><body>hi</body></html>"
    new_headers, new_body = agent._inject_block_shim(headers, body)
    assert agent._SHIM_MARKER in new_body
    assert new_body.index(agent._SHIM_MARKER) < new_body.index(b"</head>")
    # framing must match the new (longer) body exactly
    assert b"Content-Length: " + str(len(new_body)).encode() in new_headers


def test_falls_back_to_body_close_when_no_head():
    headers = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n"
    body = b"<html><body>hi</body></html>"
    new_headers, new_body = agent._inject_block_shim(headers, body)
    assert agent._SHIM_MARKER in new_body
    assert new_body.index(agent._SHIM_MARKER) < new_body.index(b"</body>")


def test_leaves_body_unchanged_when_no_insertion_point():
    headers = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n"
    body = b"just some text, not really a page"
    new_headers, new_body = agent._inject_block_shim(headers, body)
    assert new_body == body
    assert new_headers == headers


def test_idempotent_does_not_double_inject():
    headers = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n"
    body = b"<html><head></head><body>hi</body></html>"
    _, once = agent._inject_block_shim(headers, body)
    twice_headers, twice_body = agent._inject_block_shim(headers, once)
    assert twice_body == once  # second pass is a no-op


def test_gzipped_body_decompressed_injected_and_recompressed():
    original = b"<html><head><title>t</title></head><body>hi</body></html>"
    compressed = gzip.compress(original)
    headers = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Encoding: gzip\r\nContent-Length: 999\r\n\r\n"
    new_headers, new_body = agent._inject_block_shim(headers, compressed)
    # new_body must itself be valid gzip containing the injected marker
    decompressed = gzip.decompress(new_body)
    assert agent._SHIM_MARKER in decompressed
    assert b"content-encoding: gzip" in new_headers.lower()
    assert b"Content-Length: " + str(len(new_body)).encode() in new_headers


def test_corrupt_gzip_left_unchanged():
    headers = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Encoding: gzip\r\n\r\n"
    body = b"not actually gzip data"
    new_headers, new_body = agent._inject_block_shim(headers, body)
    assert new_body == body
    assert new_headers == headers
