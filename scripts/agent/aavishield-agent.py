#!/usr/bin/env python3
"""
Aavishield Agent — local proxy daemon
Runs on the employee's device and:
  1. Listens on 127.0.0.1:6118 as an HTTP/HTTPS proxy
  2. Fetches the org's domain policy over HTTPS from the admin API and caches
     it locally, then enforces block/allow decisions itself — no separate
     network-reachable gateway is required, so it keeps working on any wifi,
     mobile hotspot, or VPN the employee's laptop happens to be on.
  3. Connects directly to allowed destinations (no extra network hop).
  4. Fail-open: until the first rule set has loaded (or if refreshing later
     fails), traffic is allowed rather than blocked.
  5. Sends a heartbeat to the admin API every 60 seconds and batches activity
     events for reporting.
"""

import base64
import datetime
import errno
import hmac
import json
import logging
import os
import platform
import plistlib
import random
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import deque
from typing import Dict, List, Optional, Tuple

try:
    import resource  # POSIX-only; used to raise the open-file limit
except ImportError:  # pragma: no cover - Windows
    resource = None

try:
    # Verifies the Ed25519 signature on policy bundles (PolicySignatureVerifier
    # below). Optional at import time — unlike TLS itself, this is a defense-
    # in-depth layer on top of an already-authenticated HTTPS fetch, so a
    # missing dependency degrades to "no extra check" rather than bricking
    # the agent, the same posture pystray/Pillow already get for the tray UI.
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric import ed25519 as _ed25519
except ImportError:  # pragma: no cover - exercised via requirements-build.txt in CI
    InvalidSignature = None
    _ed25519 = None

AGENT_VERSION = "1.5.0"

CONFIG_PATH = os.path.expanduser("~/.aavishield/config.json")
LOG_PATH    = os.path.expanduser("~/.aavishield/agent.log")
LOCAL_PORT  = 6118

# Where a packaged install (.pkg / .msi / .deb) or an MDM profile can drop an
# enrollment token for an agent that has not enrolled yet. Signed packages are
# generic and identical for every employee, so the token cannot be baked in at
# build time the way the old per-download shell installers did it.
ENROLL_TOKEN_ENV   = "AAVISHIELD_ENROLL_TOKEN"
ENROLL_ADMIN_ENV   = "AAVISHIELD_ADMIN_URL"
ENROLL_PORTAL_ENV  = "AAVISHIELD_PORTAL_URL"
ENROLL_DROP_PATHS  = [
    os.path.expanduser("~/.aavishield/enroll.json"),
    "/etc/aavishield/enroll.json",
    r"C:\ProgramData\Aavishield\enroll.json",
]

# Baked in at package build time (packaging/*/build.sh rewrites these two
# lines) so a generic, notarized package knows which deployment it belongs to
# without carrying anything employee-specific. Env vars still win, which is
# what makes a single build testable against a staging server.
DEFAULT_ADMIN_URL  = "https://aavishield-api.aavishailab.com"
DEFAULT_PORTAL_URL = "https://aavishield-employee.aavishailab.com"

# First-run enrollment: when there is no config and nobody dropped a token, the
# agent opens the employee portal in a browser and listens on this port for the
# portal to hand the token back. Loopback-only, and a POST is only accepted if
# it carries the one-time state string that was in the URL we opened — so a
# random page the employee happens to have open cannot enroll this device.
ENROLL_CALLBACK_PORT    = 6119
ENROLL_BROWSER_REOPEN   = 30 * 60  # seconds before nudging the browser again

WATCHDOG_INTERVAL = 30   # seconds between system-proxy tamper checks
UPDATE_CHECK_INTERVAL = 6 * 3600  # seconds between auto-update checks
UPDATE_DOWNLOAD_TIMEOUT = 120
HEARTBEAT_INTERVAL    = 60  # seconds
RULES_REFRESH_INTERVAL = 10  # seconds — how often the local policy cache reloads;
                             # keeps company-panel policy changes reaching
                             # employees within one short interval instead of
                             # requiring a restart or reinstall
RULES_FETCH_TIMEOUT    = 10  # seconds to fetch rules from the admin API
ACTIVITY_FLUSH_INTERVAL = 5   # seconds between batched activity-event uploads
ACTIVITY_REPORT_TIMEOUT = 10  # seconds to upload a batch of activity events
ACTIVITY_DEDUP_WINDOW   = 8   # seconds — collapses the multiple connections a
                              # single page load can trigger for the same site
                              # (e.g. a bare-domain -> www redirect, or the
                              # browser opening a second/retry connection)
                              # into one log entry per actual visit
ACTIVITY_MAX_QUEUE      = 2000  # bounded retry buffer for temporary API outages
CONNECT_TIMEOUT        = 10  # seconds to establish TCP to the destination
MAX_CONCURRENT_CONNS = 1024      # cap simultaneous client connections so a flood
                                 # of traffic can't exhaust OS threads/memory
THREAD_STACK_BYTES   = 512 * 1024  # smaller per-thread stack (default is 8 MB);
                                   # lets far more relay threads coexist

# File downloads are scanned before being handed to the browser: plain HTTP
# always, HTTPS whenever SSL Inspection is on for the host (seeing inside an
# encrypted download requires TLS interception — see MITMEngine).
#
# No size ceiling. A file is spooled to a temp file as it streams past (memory
# only up to SPOOL_MEMORY, disk beyond that), so a 4GB installer costs scratch
# space and time — never RAM. Skipping large files was the old behaviour and it
# meant precisely the interesting downloads went unscanned.
SPOOL_MEMORY  = 8 * 1024 * 1024   # keep small files entirely in memory
SCAN_TIMEOUT  = 60                # base seconds to wait for a verdict
# ...plus one second per SCAN_BYTES_PER_SECOND of content, so the deadline
# tracks the transfer instead of guillotining a legitimately long scan.
SCAN_BYTES_PER_SECOND = 2 * 1024 * 1024
SCAN_CONTENT_TYPES = (
    "application/octet-stream", "application/x-msdownload", "application/x-executable",
    "application/zip", "application/x-zip-compressed", "application/x-rar-compressed",
    "application/x-7z-compressed", "application/vnd.microsoft.portable-executable",
    "application/x-dosexec", "application/java-archive",
)
SCAN_EXTENSIONS = (".exe", ".msi", ".dmg", ".pkg", ".zip", ".rar", ".7z", ".apk", ".jar", ".bat", ".sh", ".dll")

# ─── DLP + SSL Inspection (MITM) ───────────────────────────────────────────────
# Outbound request bodies (uploads, form posts) get buffered and submitted to
# admin-api for content scanning (credit card / PAN / Aadhaar / cloud key /
# keyword detection) before being forwarded — for plain HTTP directly, and for
# HTTPS only when this device's org has SSL Inspection enabled and the host
# isn't on the bypass list (see MITMEngine below). Without SSL Inspection,
# HTTPS uploads are invisible to DLP the same way HTTPS downloads are
# invisible to the malware scanner above — this is the same fundamental
# limitation, and MITMEngine is what closes it, deliberately, per-org, opt-in.
DLP_SCAN_TIMEOUT = 15  # seconds to wait for a DLP verdict
UPLOAD_METHODS = ("POST", "PUT", "PATCH")
THREAT_LOOKUP_TIMEOUT = 5
THREAT_CACHE_TTL = 5 * 60
CASB_LOOKUP_TIMEOUT = 5
CASB_CACHE_TTL = 2 * 60

MITM_CERT_DIR = os.path.expanduser("~/.aavishield/certs")
# Written by the root CA-trust helper (--ca-trust-daemon) once the org CA is
# actually in the system trust store. The agent runs unprivileged in the
# employee's session and so can neither install that CA nor honestly answer
# "is it trusted?" on its own — this marker is the privileged half of the
# install telling it the answer. Root-owned and world-readable by design.
MITM_TRUST_MARKER = (r"C:\ProgramData\Aavishield\ca-trusted"
                     if platform.system() == "Windows" else "/etc/aavishield/ca-trusted")
MITM_CA_COMMON_NAME = "Aavishield SSL Inspection CA"
CA_TRUST_POLL_INTERVAL = 60  # seconds the root helper waits between attempts
MITM_CONFIG_REFRESH_INTERVAL = 300  # seconds — how often the enabled/bypass list reloads
MITM_CONFIG_FETCH_TIMEOUT = 10
LEAF_FETCH_TIMEOUT = 15
MITM_LEAF_CACHE_MAX = 2048
# Leaves are valid 72h server-side; refetch a bit early so a cached-but-nearly-
# -expired leaf is never handed to a browser that then has to renegotiate.
LEAF_REFRESH_MARGIN = 6 * 60 * 60  # seconds
# How long a MITM'd connection stays open waiting for the client's NEXT
# request before it's considered idle and closed. Long enough that normal
# browser think-time between requests on the same connection doesn't get
# mistaken for "done"; short enough that idle connections don't pile up
# against MAX_CONCURRENT_CONNS.
KEEP_ALIVE_IDLE_TIMEOUT = 60  # seconds

# The log directory has to exist before the handler opens the file. On a fresh
# packaged install nothing has created ~/.aavishield yet, and FileHandler at
# import time would take the whole agent down before main() ever runs. If the
# file still can't be opened (read-only home, odd permissions) fall back to
# stdout only — the supervisor captures that — rather than failing to start.
_log_handlers: List[logging.Handler] = [logging.StreamHandler(sys.stdout)]
try:
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    _log_handlers.insert(0, logging.FileHandler(LOG_PATH, mode="a"))
except OSError:
    pass

logging.basicConfig(
    # Per-connection failures are logged at DEBUG, so diagnosing "the proxy
    # resets every connection" on a packaged install needs a way to turn them
    # on without a rebuild.
    level=getattr(logging, os.environ.get("AAVISHIELD_LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=_log_handlers,
)
log = logging.getLogger("aavishield")
AGENT_REVOKED = threading.Event()


# ─── Config ───────────────────────────────────────────────────────────────────

def load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return json.load(f)


def mitm_ca_trusted(config: dict) -> bool:
    """Local safety gate: never decrypt HTTPS unless this install proved the
    org CA is trusted by the OS/browser trust store.

    Two ways an install can prove it. The shell installers do the trust step
    themselves while they still hold sudo and record it in the config. Package
    installs (.pkg/.msi/.deb) can't: at postinstall time the device has not
    enrolled yet, so there are no credentials to fetch the CA with, and by the
    time it does enrol the agent is an unprivileged process in the employee's
    session. There the privileged half runs separately (--ca-trust-daemon) and
    leaves the marker behind once the CA is really in the trust store.

    Checked on every MITM config refresh rather than cached at startup, so the
    agent starts inspecting within one refresh of the helper succeeding instead
    of needing a restart."""
    return bool(config.get("mitm_ca_installed")) or os.path.exists(MITM_TRUST_MARKER)


def _ca_bundle() -> Optional[str]:
    """Locate a CA bundle for verifying the admin API's certificate.

    A PyInstaller build ships its own OpenSSL, whose compiled-in cert paths
    point at the *build* machine's layout (e.g. Homebrew's
    /opt/homebrew/etc/openssl@3) — directories that need not exist on an
    employee's Mac, and that launchd's bare environment does not supply. With
    no bundle every HTTPS call fails CERTIFICATE_VERIFY_FAILED, so the agent
    can neither enrol nor heartbeat and the device never appears in the
    dashboard. Prefer the bundled certifi, then the platform's own store.
    """
    try:
        import certifi  # noqa: PLC0415
        return certifi.where()
    except ImportError:
        pass
    for path in ("/etc/ssl/cert.pem",                 # macOS
                 "/etc/ssl/certs/ca-certificates.crt",  # Debian/Ubuntu
                 "/etc/pki/tls/certs/ca-bundle.crt"):   # RHEL/Fedora
        if os.path.exists(path):
            return path
    return None


def _build_ssl_context() -> ssl.SSLContext:
    bundle = _ca_bundle()
    if bundle:
        # Also exported so subprocesses and any library that builds its own
        # context (rather than using ours) resolve the same trust store.
        os.environ.setdefault("SSL_CERT_FILE", bundle)
        return ssl.create_default_context(cafile=bundle)
    log.warning("no CA bundle found — TLS verification may fail")
    return ssl.create_default_context()


_SSL_CONTEXT = _build_ssl_context()

# The agent enables a system-wide proxy pointing at itself. urllib normally
# honours that system proxy, which would send the agent's OWN admin-API calls
# (heartbeat / rules / activity / offline) back through 127.0.0.1:6118 — a loop
# that never reaches the server. This opener has an empty ProxyHandler, forcing
# those calls to connect directly.
_DIRECT_OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    urllib.request.HTTPSHandler(context=_SSL_CONTEXT),
)


def _agent_request(config: dict, path: str, method: str = "GET", body: Optional[bytes] = None):
    req = urllib.request.Request(
        f"{config['admin_url'].rstrip('/')}{path}",
        data=body,
        method=method,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {config['device_id']}:{config['agent_key']}",
            # Python's default urllib User-Agent ("Python-urllib/x.y") is a
            # well-known bot signature that Cloudflare's Bot Fight Mode blocks
            # by default, which would 403 every agent call while curl-based
            # calls (enrollment) sail through unaffected.
            "User-Agent":    "AavishieldAgent/1.0",
        },
    )
    return req


def mark_revoked_if_auth_error(exc: BaseException) -> bool:
    if isinstance(exc, urllib.error.HTTPError) and exc.code in (401, 403):
        if not AGENT_REVOKED.is_set():
            log.error("Agent credentials were rejected by admin API (HTTP %d); switching to unmanaged blind-tunnel mode", exc.code)
        AGENT_REVOKED.set()
        return True
    return False


# ─── Policy signature verification ──────────────────────────────────────────────

# Sibling of CONFIG_PATH's directory, not a new top-level location — keeps
# every piece of this device's local state under the one ~/.aavishield/ dir.
_POLICY_PUBKEY_PATH = os.path.join(os.path.dirname(CONFIG_PATH), "policy-signing-key.pub")


class PolicySignatureVerifier:
    """
    Verifies the Ed25519 signature admin-api attaches to every policy bundle
    (X-Policy-Signature / X-Policy-Key-Id on GET /internal/agent/rules) —
    this agent's half of the contract services/admin-api/internal/policysig
    implements. A bundle that arrived over an authenticated HTTPS connection
    has proven who sent it, not that the bytes weren't altered somewhere
    between the database and this device; the signature is what proves the
    latter.

    Trust-on-first-use, deliberately: the public key is fetched once and
    pinned to ~/.aavishield/policy-signing-key.pub, the same posture the org
    CA certificate already gets for MITM. Re-fetching on every restart would
    let whoever controls the network path at that exact moment hand a fresh
    device a different key, silently defeating the point of signing at all.
    """

    def __init__(self, config: dict):
        self.config = config
        self._lock = threading.Lock()
        self._key_id: Optional[str] = None
        self._public_key = None
        self._warned_no_crypto = False

    def ensure_key(self):
        if _ed25519 is None:
            if not self._warned_no_crypto:
                log.warning("cryptography package not available — policy bundle signatures will NOT be verified")
                self._warned_no_crypto = True
            return
        with self._lock:
            if self._public_key is not None:
                return
        pinned = self._load_pinned()
        if pinned:
            with self._lock:
                self._key_id, self._public_key = pinned
            log.info("Loaded pinned policy signing key (key_id=%s)", pinned[0])
            return
        fetched = self._fetch_and_pin()
        if fetched:
            with self._lock:
                self._key_id, self._public_key = fetched

    def _load_pinned(self):
        try:
            with open(_POLICY_PUBKEY_PATH, "r", encoding="utf-8") as f:
                lines = f.read().splitlines()
            key_id, pubkey_b64 = lines[0].strip(), lines[1].strip()
        except (OSError, IndexError):
            return None
        return self._parse_key(key_id, pubkey_b64)

    def _fetch_and_pin(self):
        try:
            req = _agent_request(self.config, "/internal/agent/policy-public-key")
            with _DIRECT_OPENER.open(req, timeout=RULES_FETCH_TIMEOUT) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError, OSError) as exc:
            mark_revoked_if_auth_error(exc)
            log.warning("Could not fetch policy signing public key (%s) — bundles will be rejected until this succeeds", exc)
            return None

        key_id, pubkey_b64 = body.get("key_id", ""), body.get("public_key", "")
        parsed = self._parse_key(key_id, pubkey_b64)
        if parsed is None:
            log.warning("Policy signing public key endpoint returned an unusable key")
            return None
        try:
            os.makedirs(os.path.dirname(_POLICY_PUBKEY_PATH), exist_ok=True)
            with open(_POLICY_PUBKEY_PATH, "w", encoding="utf-8") as f:
                f.write(f"{key_id}\n{pubkey_b64}\n")
            log.info("Pinned policy signing public key (key_id=%s)", key_id)
        except OSError as exc:
            log.warning("Could not persist pinned policy signing key (%s) — will re-fetch next restart", exc)
        return parsed

    @staticmethod
    def _parse_key(key_id: str, pubkey_b64: str):
        if not key_id or not pubkey_b64:
            return None
        try:
            raw = base64.b64decode(pubkey_b64, validate=True)
            key = _ed25519.Ed25519PublicKey.from_public_bytes(raw)
        except (ValueError, TypeError):
            return None
        return key_id, key

    def verify(self, body: bytes, sig_b64: Optional[str], key_id: Optional[str]) -> bool:
        """Every failure mode is a hard reject EXCEPT the cryptography package
        being unavailable at all, which fails open (logged once in
        ensure_key) — a missing optional dependency degrading a defense-in-
        depth layer is not the same risk as an actual bad signature."""
        if _ed25519 is None:
            return True
        if not sig_b64 or not key_id:
            log.warning("Policy bundle missing signature headers — rejecting")
            return False
        with self._lock:
            pinned_id, key = self._key_id, self._public_key
        if key is None:
            log.warning("No pinned policy signing key available yet — rejecting")
            return False
        if pinned_id != key_id:
            log.warning("Policy signature key_id mismatch (pinned=%s got=%s) — rejecting", pinned_id, key_id)
            return False
        try:
            sig = base64.b64decode(sig_b64, validate=True)
            key.verify(sig, body)
            return True
        except (InvalidSignature, ValueError, TypeError):
            log.warning("Policy bundle signature does not verify — rejecting (possible tampering)")
            return False


# ─── Policy cache ──────────────────────────────────────────────────────────────

class PolicyCache:
    """
    Local copy of the org's domain rules, refreshed periodically over HTTPS
    from the admin API (the same public endpoint the dashboards use — always
    reachable from anywhere, unlike a raw TCP proxy sitting behind a LAN/NAT).
    Until the first successful load, check() returns None (allow) so a
    momentarily-unreachable admin API doesn't brick browsing.
    """

    def __init__(self, config: dict):
        self.config = config
        self._lock = threading.Lock()
        self._by_domain: dict = {}
        self._loaded = False
        self._sig_verifier = PolicySignatureVerifier(config)

    def refresh(self):
        if AGENT_REVOKED.is_set():
            return
        self._sig_verifier.ensure_key()
        try:
            req = _agent_request(self.config, "/internal/agent/rules")
            with _DIRECT_OPENER.open(req, timeout=RULES_FETCH_TIMEOUT) as resp:
                raw = resp.read()
                sig = resp.headers.get("X-Policy-Signature")
                key_id = resp.headers.get("X-Policy-Key-Id")
        except (urllib.error.URLError, ValueError, OSError) as exc:
            mark_revoked_if_auth_error(exc)
            log.warning("Rule refresh failed (%s) — keeping cached rules", exc)
            return

        # Reject outright rather than apply an unverified bundle — a network
        # position that can serve a 200 with a plausible-looking JSON body is
        # exactly the threat this signature defends against.
        if not self._sig_verifier.verify(raw, sig, key_id):
            return

        try:
            body = json.loads(raw.decode("utf-8"))
        except ValueError as exc:
            log.warning("Rule refresh returned unparseable body (%s) — keeping cached rules", exc)
            return

        index: dict = {}
        for rule in body.get("rules") or []:
            domain = (rule.get("domain") or "").strip().lower()
            if not domain:
                continue
            index.setdefault(domain, []).append(rule)

        with self._lock:
            self._by_domain = index
            self._loaded = True
        log.info("Policy cache loaded: %d domain rule(s)", sum(len(v) for v in index.values()))

    def loop_refresh(self):
        while True:
            time.sleep(RULES_REFRESH_INTERVAL)
            self.refresh()

    def check(self, domain: str) -> Optional[dict]:
        """Returns the matching rule dict, or None if no rule applies (allow)."""
        if AGENT_REVOKED.is_set():
            return None
        domain = domain.lower()
        if domain.startswith("www."):
            domain = domain[4:]

        with self._lock:
            by_domain = self._by_domain

        rule = self._match(by_domain, domain)
        if rule is not None:
            return rule

        # Walk parent domains (e.g. cdn.instagram.com -> instagram.com), skipping
        # single-label parents like "com" to avoid ever blocking an entire TLD.
        parts = domain.split(".")
        for i in range(1, len(parts)):
            parent = ".".join(parts[i:])
            if "." not in parent:
                continue
            rule = self._match(by_domain, parent)
            if rule is not None:
                return rule

        return None

    @staticmethod
    def _match(by_domain: dict, domain: str) -> Optional[dict]:
        rules = by_domain.get(domain)
        if not rules:
            return None
        # Org-specific rule takes priority over a global (org_id null) one.
        for r in rules:
            if r.get("org_id"):
                return r
        for r in rules:
            if not r.get("org_id"):
                return r
        return None


# ─── Threat intelligence cache ────────────────────────────────────────────────

class ThreatIntelCache:
    def __init__(self, config: dict):
        self.config = config
        self._lock = threading.Lock()
        self._cache: Dict[str, Tuple[float, Optional[dict]]] = {}

    def check(self, host: str) -> Optional[dict]:
        if AGENT_REVOKED.is_set():
            return None
        host = host.lower()
        if host.startswith("www."):
            host = host[4:]
        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(host)
            if cached is not None and cached[0] > now:
                return cached[1]

        verdict = self._lookup(host)
        with self._lock:
            self._cache[host] = (now + THREAT_CACHE_TTL, verdict)
            if len(self._cache) > 2048:
                expired = [k for k, (expiry, _) in self._cache.items() if expiry <= now]
                for k in expired:
                    self._cache.pop(k, None)
        return verdict

    def _lookup(self, host: str) -> Optional[dict]:
        try:
            query = urllib.parse.urlencode({"domain": host})
            req = _agent_request(self.config, f"/internal/agent/threat-lookup?{query}")
            with _DIRECT_OPENER.open(req, timeout=THREAT_LOOKUP_TIMEOUT) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError, OSError) as exc:
            mark_revoked_if_auth_error(exc)
            return None

        band = (result.get("band") or "allow").lower()
        score = int(result.get("score") or 0)
        if band not in ("block", "alert") and score < 50:
            return None
        action = "block" if band == "block" or score >= 80 else "alert"
        reasons = result.get("reasons") or []
        reason = "; ".join(str(r) for r in reasons if r) or "Threat intelligence risk"
        return {
            "action": action,
            "category": result.get("category") or "threat_intelligence",
            "reason": reason,
            "risk_score": score,
            "source": "threat_intelligence",
        }


# ─── CASB inline app-control cache ────────────────────────────────────────────

class CASBControlCache:
    def __init__(self, config: dict):
        self.config = config
        self._lock = threading.Lock()
        self._cache: Dict[Tuple[str, str], Tuple[float, Optional[dict]]] = {}

    def check(self, host: str, activity: str) -> Optional[dict]:
        if AGENT_REVOKED.is_set():
            return None
        host = host.lower()
        if host.startswith("www."):
            host = host[4:]
        key = (host, activity)
        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None and cached[0] > now:
                return cached[1]

        verdict = self._lookup(host, activity)
        with self._lock:
            self._cache[key] = (now + CASB_CACHE_TTL, verdict)
            if len(self._cache) > 2048:
                expired = [k for k, (expiry, _) in self._cache.items() if expiry <= now]
                for k in expired:
                    self._cache.pop(k, None)
        return verdict

    def _lookup(self, host: str, activity: str) -> Optional[dict]:
        try:
            query = urllib.parse.urlencode({"domain": host, "activity": activity})
            req = _agent_request(self.config, f"/internal/agent/casb/app-control?{query}")
            with _DIRECT_OPENER.open(req, timeout=CASB_LOOKUP_TIMEOUT) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError, OSError) as exc:
            mark_revoked_if_auth_error(exc)
            return None

        action = (result.get("action") or "allow").lower()
        if action not in ("block", "alert"):
            return None
        return {
            "action": action,
            "category": "CASB App Control",
            "reason": result.get("reason") or "CASB app-control policy",
            "matched_rule": result.get("matched_rule") or "",
        }


# ─── Application control (process watcher) ────────────────────────────────────

class AppControlWatcher:
    """Blocks applications, not just their websites.

    Blocking a domain stops the browser, but an app that is already installed
    keeps launching and keeps talking to whichever backend host nobody thought
    to add to the policy. The network half of that is solved by shipping each
    app's full domain bundle in the normal rule feed; this is the other half —
    a process that matches a controlled application is terminated on sight and
    reported, so the dashboard shows who tried to run what.

    Honest scope, so nobody mistakes this for more than it is: this is
    userland, polled, and identified by the executable's path. It stops the app
    from being usable; it does not stop the binary from executing for the second
    or two before a sweep notices, and someone who renames the executable
    defeats the name match (the bundle-id and path matchers are harder to dodge,
    not impossible). An app launched through an interpreter is also invisible
    here, because the OS reports the interpreter as the executable — every
    application in the catalog is a compiled binary, for which the reported path
    is the app's own. Preventing execution outright needs OS-level enforcement —
    macOS Endpoint Security, Windows WDAC/AppLocker — which requires signed
    system extensions and MDM. Termination is what can be done today on an
    unmanaged laptop, and the network block behind it is what actually makes
    the app pointless.
    """

    def __init__(self, config: dict):
        self.config = config
        self.matchers: List[dict] = []
        self.interval = 15
        self.lock = threading.Lock()
        # PIDs already reported, so one long-running app doesn't emit an event
        # every sweep. Cleared whenever the process is gone.
        self.reported: Dict[int, str] = {}
        self._bundle_cache: Dict[str, str] = {}
        self.system = platform.system()

    # ── policy ────────────────────────────────────────────────────────────
    def refresh(self):
        try:
            req = _agent_request(self.config, "/internal/agent/app-control")
            with _DIRECT_OPENER.open(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            mark_revoked_if_auth_error(exc)
            log.debug("app-control refresh failed: %s", exc)
            return

        matchers = data.get("applications") or []
        with self.lock:
            self.matchers = matchers
            self.interval = max(5, int(data.get("poll_interval_sec") or 15))
        if matchers:
            log.info("Application control: watching for %d application(s)",
                     len(matchers))

    def loop(self):
        tick = 0
        while True:
            # Rules change rarely, processes constantly — sweep every tick, but
            # only re-read policy every fourth one.
            if tick % 4 == 0:
                self.refresh()
            tick += 1

            with self.lock:
                interval, active = self.interval, bool(self.matchers)
            if active:
                try:
                    self.sweep()
                except Exception as exc:  # noqa: BLE001 - never kill the thread
                    log.debug("app-control sweep failed: %s", exc)
            time.sleep(interval)

    # ── process enumeration ───────────────────────────────────────────────
    def _processes(self) -> List[Tuple[int, str]]:
        """Returns (pid, executable path). Uses whatever the OS already ships —
        psutil would be a dependency the agent deliberately doesn't have, since
        it is distributed as a single file.

        Only the executable path is matched on, never the command line. A
        process whose arguments merely mention an app (a grep, an editor, a
        build script) is not that app, and terminating it because of a string
        in its argv would be indefensible.
        """
        if self.system == "Windows":
            rc, out = _run([
                "powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process | "
                "ForEach-Object { \"$($_.ProcessId)|$($_.ExecutablePath)\" }",
            ])
            if rc != 0:
                return []
            procs = []
            for line in out.splitlines():
                pid_str, _, path = line.strip().partition("|")
                if pid_str.isdigit() and path:
                    procs.append((int(pid_str), path))
            return procs

        # "pid=,comm=" and not "pid=,comm=,args=": an executable path can
        # contain spaces ("/Applications/Google Chrome.app/…/Google Chrome"),
        # so a multi-field line has no unambiguous split point. With one field,
        # everything after the pid is that field.
        rc, out = _run(["ps", "-axo", "pid=,comm="])
        if rc != 0:
            return []
        procs = []
        for line in out.splitlines():
            pid_str, _, path = line.strip().partition(" ")
            path = path.strip()
            if pid_str.isdigit() and path:
                procs.append((int(pid_str), path))
        return procs

    def _bundle_id(self, exe_path: str) -> str:
        """CFBundleIdentifier of the .app a macOS executable lives in, or "".

        Cached per bundle path: a browser alone contributes dozens of helper
        processes out of one bundle, and this would otherwise read the same
        plist on every sweep.
        """
        if self.system != "Darwin" or ".app/" not in exe_path:
            return ""
        bundle = exe_path[: exe_path.rindex(".app/") + 4]
        if bundle in self._bundle_cache:
            return self._bundle_cache[bundle]

        ident = ""
        try:
            with open(os.path.join(bundle, "Contents", "Info.plist"), "rb") as fh:
                ident = plistlib.load(fh).get("CFBundleIdentifier", "") or ""
        except (OSError, ValueError, plistlib.InvalidFileException):
            ident = ""
        self._bundle_cache[bundle] = ident
        return ident

    def _matches(self, matcher: dict, exe_path: str) -> bool:
        exe_name = os.path.basename(exe_path).lower()
        path_lower = exe_path.lower()

        for name in matcher.get("process_names") or []:
            if exe_name == name.strip().lower():
                return True
        for pattern in matcher.get("path_patterns") or []:
            pattern = pattern.strip().lower()
            if pattern and pattern in path_lower:
                return True

        bundles = matcher.get("bundle_ids") or []
        if bundles:
            ident = self._bundle_id(exe_path).lower()
            if ident and any(ident == b.strip().lower() for b in bundles):
                return True
        return False

    def sweep(self):
        # Terminating somebody's applications on their own laptop in their own
        # time is exactly what a working-hours schedule exists to prevent.
        if not GATE.enforces_app_control():
            return
        with self.lock:
            matchers = list(self.matchers)
        if not matchers:
            return

        seen_pids = set()
        own_pid = os.getpid()
        for pid, exe_path in self._processes():
            if pid == own_pid:
                continue
            for matcher in matchers:
                if not self._matches(matcher, exe_path):
                    continue
                seen_pids.add(pid)
                terminated = False
                if matcher.get("action") != "alert":
                    terminated = self._terminate(pid)
                # One event per (pid, app) — a user who relaunches gets a new
                # PID and therefore a new event, which is the signal we want.
                if self.reported.get(pid) != matcher.get("app_id"):
                    self.reported[pid] = matcher.get("app_id")
                    self._report(matcher, pid, os.path.basename(exe_path), exe_path, terminated)
                    log.info("APP %s: %s (pid %d)",
                             "BLOCKED" if terminated else "DETECTED",
                             matcher.get("name"), pid)
                break

        # Forget PIDs that are gone, so the same app relaunching is reported.
        for pid in list(self.reported):
            if pid not in seen_pids:
                del self.reported[pid]

    def _terminate(self, pid: int) -> bool:
        try:
            if self.system == "Windows":
                rc, _ = _run(["taskkill", "/PID", str(pid), "/T", "/F"])
                return rc == 0
            os.kill(pid, signal.SIGKILL)
            return True
        except (OSError, PermissionError) as exc:
            # A process owned by another user (or root) can't be killed from
            # here. Still reported — the dashboard shows it was seen and why
            # it survived.
            log.debug("could not terminate pid %d: %s", pid, exc)
            return False

    def _report(self, matcher: dict, pid: int, exe_name: str, cmdline: str, terminated: bool):
        payload = json.dumps({
            "app_id":       matcher.get("app_id"),
            "app_name":     matcher.get("name"),
            "process_name": exe_name,
            "pid":          pid,
            "path":         cmdline[:500],
            "action":       "blocked" if terminated else "alerted",
            "terminated":   terminated,
        }).encode("utf-8")
        try:
            req = _agent_request(self.config, "/internal/agent/app-block",
                                 method="POST", body=payload)
            with _DIRECT_OPENER.open(req, timeout=10):
                pass
        except (urllib.error.URLError, OSError) as exc:
            mark_revoked_if_auth_error(exc)
            log.debug("app-block report failed: %s", exc)


# ─── Working-hours enforcement ────────────────────────────────────────────────

class EnforcementGate:
    """Decides, moment to moment, how much of this agent is switched on.

    The reason this exists is BYOD. On a personal laptop, running the full
    agent at 11pm means intercepting somebody's private browsing on their own
    machine — so a company can give a device (or a team, or everyone) working
    hours, outside of which the agent stands down. A company-owned laptop has
    no schedule and nothing changes: absent a schedule, enforcement is
    continuous.

    The schedule is *evaluated on the server*, never here. This agent runs on
    hardware whose clock and timezone belong to the person being monitored;
    deciding locally would mean "set the clock to Sunday" turns enforcement
    off. The server sends a verdict plus the instant it expires, and this class
    holds that verdict against a **monotonic** clock, so moving the system
    clock forwards doesn't end the working day early either.

    Three modes:
      full           — everything on (the default, and the only mode a
                       company-owned device ever sees)
      security_only  — the parts that protect the machine (malware scanning,
                       threat intelligence) stay on; everything that observes
                       the person (activity logging, DLP, application control,
                       policy blocking) goes quiet
      paused         — nothing. The system proxy is removed so traffic goes
                       direct and the employee's own browsing is untouched.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._mode = "full"
        self._reason = "Enforcing continuously"
        # Monotonic deadline for the current verdict, not a wall-clock time.
        self._expires_at: Optional[float] = None
        self._until_text = ""
        self._source = ""
        self._last_update = time.monotonic()

    # ── state ─────────────────────────────────────────────────────────────
    @property
    def mode(self) -> str:
        with self._lock:
            # The verdict has outlived its window and no fresh one arrived
            # (server unreachable, machine asleep). Holding the last known
            # state is the lesser evil: an employee who blocks the server would
            # otherwise freeze enforcement off, and they can already stop the
            # agent outright, so this is not the weakest link.
            return self._mode

    @property
    def reason(self) -> str:
        with self._lock:
            return self._reason

    @property
    def until_text(self) -> str:
        with self._lock:
            return self._until_text

    # ── capability questions the rest of the agent asks ───────────────────
    def intercepts(self) -> bool:
        """Should the system proxy point at us at all?"""
        return self.mode != "paused"

    def enforces_policy(self) -> bool:
        """Domain block/allow rules and application-control domains."""
        return self.mode == "full"

    def enforces_dlp(self) -> bool:
        return self.mode == "full"

    def enforces_app_control(self) -> bool:
        return self.mode == "full"

    def scans_downloads(self) -> bool:
        """Malware scanning protects the machine, not the company's view of
        the person — so it survives into security_only."""
        return self.mode in ("full", "security_only")

    def checks_threat_intel(self) -> bool:
        return self.mode in ("full", "security_only")

    def captures_screenshots(self) -> bool:
        """Screenshots and activity tracking are monitoring, not machine
        protection — so they run only in full enforcement, never in
        security_only and never while paused. On a personal laptop this is what
        guarantees nothing is captured outside working hours."""
        return self.mode == "full"

    def logs(self, kind: str = "activity") -> bool:
        """`activity` is ordinary browsing telemetry; `security` is a malware
        or threat-intel block. Off hours, only the latter is defensible."""
        mode = self.mode
        if mode == "full":
            return True
        if mode == "security_only":
            return kind == "security"
        return False

    # ── updates from the server ───────────────────────────────────────────
    def apply(self, payload: Optional[dict], server_time: Optional[str] = None) -> Optional[str]:
        """Takes the heartbeat's enforcement block. Returns the new mode if it
        changed, else None, so the caller can act on the transition."""
        if not isinstance(payload, dict):
            return None

        mode = payload.get("mode") or ("full" if payload.get("active") else "paused")
        if mode not in ("full", "security_only", "paused"):
            mode = "full"

        # Convert the server's absolute deadline into a monotonic one using the
        # gap it reports, so our own wall clock never enters the calculation.
        expires_at = None
        until_text = ""
        until = payload.get("until")
        if until:
            try:
                remaining = _seconds_between(server_time, until)
                if remaining is not None and remaining > 0:
                    expires_at = time.monotonic() + remaining
                until_text = str(until)
            except (ValueError, TypeError):
                expires_at = None

        with self._lock:
            changed = mode != self._mode
            self._mode = mode
            self._reason = payload.get("reason") or ""
            self._source = payload.get("source") or ""
            self._expires_at = expires_at
            self._until_text = until_text
            self._last_update = time.monotonic()
        return mode if changed else None


def _seconds_between(server_time: Optional[str], until: str) -> Optional[float]:
    """Seconds from the server's "now" to `until`, both RFC3339. Using the
    server's own clock for both ends keeps the device's clock out of it."""
    end = _parse_rfc3339(until)
    if end is None:
        return None
    start = _parse_rfc3339(server_time) if server_time else None
    if start is None:
        start = datetime.datetime.now(datetime.timezone.utc)
    return (end - start).total_seconds()


def _parse_rfc3339(value: Optional[str]) -> Optional["datetime.datetime"]:
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    # Python can't parse more than 6 fractional-second digits; Go emits 9.
    if "." in text:
        head, _, tail = text.partition(".")
        digits = ""
        for ch in tail:
            if ch.isdigit():
                digits += ch
            else:
                tail = tail[len(digits):]
                break
        else:
            tail = ""
        text = f"{head}.{digits[:6]}{tail}"
    try:
        parsed = datetime.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed


GATE = EnforcementGate()


def apply_enforcement_transition(new_mode: str):
    """Arms or disarms the interception layer when the mode changes.

    The critical part is the proxy. If the agent simply stopped inspecting but
    the OS still pointed at 127.0.0.1, every request on that laptop would fail
    — we would have broken the employee's personal machine rather than left it
    alone. Pausing therefore *removes the system proxy* so traffic goes direct.
    """
    if new_mode == "paused":
        log.info("Outside working hours — standing down (%s)", GATE.reason or "schedule")
        if system_proxy_active():
            clear_system_proxy()
        return

    log.info("Enforcement active (%s)", GATE.reason or "no schedule")
    if not system_proxy_active():
        apply_system_proxy()


# ─── Activity reporting (batched, async) ──────────────────────────────────────

class ActivityReporter:
    """
    Queues block/allow events in memory and uploads them in small batches on a
    background thread, so reporting never adds latency to the request the
    employee is actually waiting on.
    """

    def __init__(self, config: dict):
        self.config = config
        self._lock = threading.Lock()
        self._queue: deque = deque()
        self._recent: dict = {}  # (canonical_domain, action) -> monotonic time last recorded

    def record(self, target_url: str, domain: str, action: str, rule: Optional[dict],
               event_type: str = "web_request", kind: str = "activity"):
        # Dropped, not queued: an event captured after the working day ended
        # must never be uploaded later. Queuing it would mean the employee's
        # evening shows up on the dashboard the next morning.
        if not GATE.logs(kind):
            return

        canonical_domain = domain.lower()
        if canonical_domain.startswith("www."):
            canonical_domain = canonical_domain[4:]

        now = time.monotonic()
        key = (canonical_domain, action)
        with self._lock:
            last = self._recent.get(key)
            if last is not None and now - last < ACTIVITY_DEDUP_WINDOW:
                return  # same site+outcome fired again almost instantly — one visit, not two
            self._recent[key] = now
            if len(self._recent) > 512:
                cutoff = now - ACTIVITY_DEDUP_WINDOW
                self._recent = {k: v for k, v in self._recent.items() if v >= cutoff}

            event = {
                "event_type":    event_type,
                "action":        action,
                "target":        target_url,
                "target_domain": canonical_domain,
                "category":      (rule or {}).get("category", ""),
                "policy_name":   (rule or {}).get("reason", ""),
                "risk_score":    (rule or {}).get("risk_score", 0),
                "timestamp":     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            self._queue.append(event)

    def loop_flush(self):
        while True:
            time.sleep(ACTIVITY_FLUSH_INTERVAL)
            self._flush()

    def _flush(self):
        with self._lock:
            if not self._queue:
                return
            batch = list(self._queue)
            self._queue.clear()

        try:
            body = json.dumps(batch).encode("utf-8")
            req = _agent_request(self.config, "/internal/agent/activity", method="POST", body=body)
            with _DIRECT_OPENER.open(req, timeout=ACTIVITY_REPORT_TIMEOUT):
                pass
        except (urllib.error.URLError, OSError) as exc:
            mark_revoked_if_auth_error(exc)
            with self._lock:
                for event in reversed(batch):
                    self._queue.appendleft(event)
                while len(self._queue) > ACTIVITY_MAX_QUEUE:
                    self._queue.pop()
            log.debug("Activity report failed (%s) — requeued %d event(s)", exc, len(batch))


# ─── SSL Inspection (MITM) ─────────────────────────────────────────────────────

class MITMEngine:
    """
    Terminates TLS locally for HTTPS connections whose destination is
    neither policy-blocked nor on the org's bypass list, so DLP (and the
    malware scanner) can see the plaintext — then re-encrypts to the real
    upstream. Both legs use short-lived, per-host leaf certificates signed
    by the org's own CA (internal/mitm on admin-api); the CA's private key
    never reaches this device, only these narrow, expiring leaves do.

    Because this agent is an explicit CONNECT proxy, the destination
    hostname is already known from the CONNECT line itself — unlike a
    transparent (non-proxy) TLS interceptor, there's no need to inspect the
    ClientHello's SNI to pick the right certificate before the handshake.

    Fail-open, same as everything else here: if the org hasn't enabled SSL
    Inspection, if a host is on the bypass list (certificate-pinned apps,
    OS/update services), or if a leaf certificate can't be obtained, the
    connection just falls through to the existing blind tunnel — DLP simply
    doesn't see that particular HTTPS body, exactly as it wouldn't without
    this feature at all.
    """

    def __init__(self, config: dict):
        self.config = config
        self._lock = threading.Lock()
        self._enabled = False
        self._bypass: set = set()
        self._leaf_cache: Dict[str, Tuple[str, str, float]] = {}  # host -> (certfile, keyfile, expiry)
        os.makedirs(MITM_CERT_DIR, mode=0o700, exist_ok=True)

    def refresh(self):
        if AGENT_REVOKED.is_set():
            with self._lock:
                self._enabled = False
            return
        try:
            req = _agent_request(self.config, "/internal/agent/mitm-config")
            with _DIRECT_OPENER.open(req, timeout=MITM_CONFIG_FETCH_TIMEOUT) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError, OSError) as exc:
            mark_revoked_if_auth_error(exc)
            log.debug("MITM config refresh failed (%s) — keeping previous config", exc)
            return

        bypass = {str(d).lower().lstrip("www.") for d in (body.get("bypass_domains") or [])}
        enabled = bool(body.get("enabled")) and mitm_ca_trusted(self.config)
        if body.get("enabled") and not enabled:
            log.warning("SSL Inspection is enabled by policy, but the local CA is not trusted; using blind HTTPS tunnels")
        with self._lock:
            self._enabled = enabled
            self._bypass = bypass

    def loop_refresh(self):
        while True:
            time.sleep(MITM_CONFIG_REFRESH_INTERVAL)
            self.refresh()

    def should_intercept(self, host: str) -> bool:
        # Terminating TLS on a personal laptop outside working hours is the
        # single most intrusive thing this agent does, so it is the first thing
        # to stop.
        if not GATE.intercepts():
            return False
        if AGENT_REVOKED.is_set():
            return False
        host = host.lower()
        if host.startswith("www."):
            host = host[4:]
        with self._lock:
            if not self._enabled:
                return False
            bypass = self._bypass
        if host in bypass:
            return False
        for entry in bypass:
            if entry.startswith("*.") and host.endswith(entry[1:]):
                return False
        parts = host.split(".")
        for i in range(1, len(parts)):
            if ".".join(parts[i:]) in bypass:
                return False
        return True

    def get_leaf(self, host: str) -> Optional[Tuple[str, str]]:
        """Returns (certfile_path, keyfile_path) for host, fetching and
        caching a fresh leaf from admin-api if none is cached or the cached
        one is close to expiry. Returns None if a leaf can't be obtained —
        callers must fall back to a blind tunnel, not fail the connection."""
        if AGENT_REVOKED.is_set():
            return None
        now = time.time()
        with self._lock:
            self._prune_cache_locked(now)
            cached = self._leaf_cache.get(host)
        if cached is not None and cached[2] > now:
            return cached[0], cached[1]

        try:
            payload = json.dumps({"hostname": host}).encode("utf-8")
            req = _agent_request(self.config, "/internal/agent/sign-cert", method="POST", body=payload)
            with _DIRECT_OPENER.open(req, timeout=LEAF_FETCH_TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, ValueError, OSError) as exc:
            mark_revoked_if_auth_error(exc)
            log.debug("Leaf cert fetch failed for %s (%s)", host, exc)
            return None

        cert_pem = data.get("cert_pem")
        key_pem = data.get("key_pem")
        expires_in = data.get("expires_in") or 0
        if not cert_pem or not key_pem:
            return None

        safe_name = "".join(c if c.isalnum() or c in ".-" else "_" for c in host)
        certfile = os.path.join(MITM_CERT_DIR, safe_name + ".crt")
        keyfile = os.path.join(MITM_CERT_DIR, safe_name + ".key")
        try:
            _write_private(certfile, cert_pem)
            _write_private(keyfile, key_pem)
        except OSError as exc:
            log.debug("Failed to cache leaf cert for %s (%s)", host, exc)
            return None

        expiry = now + max(0, expires_in - LEAF_REFRESH_MARGIN)
        with self._lock:
            self._leaf_cache[host] = (certfile, keyfile, expiry)
            self._prune_cache_locked(now)
        return certfile, keyfile

    def _prune_cache_locked(self, now: float):
        expired = [host for host, (_, _, expiry) in self._leaf_cache.items() if expiry <= now]
        overflow = max(0, len(self._leaf_cache) - MITM_LEAF_CACHE_MAX)
        if overflow:
            oldest = sorted(self._leaf_cache.items(), key=lambda item: item[1][2])[:overflow]
            expired.extend(host for host, _ in oldest)
        for host in expired:
            certfile, keyfile, _ = self._leaf_cache.pop(host, ("", "", 0))
            for path in (certfile, keyfile):
                if path:
                    try:
                        os.remove(path)
                    except OSError:
                        pass


def _write_private(path: str, content: str):
    """Writes content to path with 0600 perms from the moment it's created
    (not applied after the fact) — these files hold a private key."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
    except Exception:
        raise


# ─── Proxy connection handler ─────────────────────────────────────────────────

BLOCK_PAGE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aavishield — Access Blocked</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: 'Segoe UI', sans-serif; background: #f0f4fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }}
    .card {{ background: white; border-radius: 12px; padding: 48px; max-width: 480px; width: 90%; box-shadow: 0 4px 24px rgba(0,72,160,0.12); text-align: center; }}
    .shield {{ font-size: 64px; margin-bottom: 24px; }}
    h1 {{ color: #0048A0; font-size: 24px; margin-bottom: 12px; }}
    p {{ color: #555; line-height: 1.6; margin-bottom: 8px; }}
    .domain {{ font-weight: 600; color: #0048A0; }}
    .policy {{ background: #f0f4fa; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 14px; color: #333; }}
    .footer {{ margin-top: 24px; font-size: 12px; color: #999; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="shield">\U0001F6E1</div>
    <h1>Access Blocked</h1>
    <p>This website has been blocked by your organization's security policy.</p>
    <div class="policy">
      <strong>Domain:</strong> <span class="domain">{domain}</span><br>
      <strong>Reason:</strong> {reason}<br>
      <strong>Category:</strong> {category}
    </div>
    <p>If you believe this is a mistake, please contact your IT administrator.</p>
    <div class="footer">Protected by <strong>Aavishield</strong> Zero Trust Security</div>
  </div>
</body>
</html>"""


class ProxyConnection(threading.Thread):
    """Handles a single client connection to the local proxy."""

    def __init__(self, conn: socket.socket, addr, cache: PolicyCache, reporter: ActivityReporter,
                 threats: Optional[ThreatIntelCache] = None, casb: Optional[CASBControlCache] = None,
                 mitm: Optional["MITMEngine"] = None, slot=None):
        super().__init__(daemon=True)
        self.conn     = conn
        self.addr     = addr
        self.cache    = cache
        self.reporter = reporter
        self.threats  = threats
        self.casb     = casb
        self.mitm     = mitm
        self.slot     = slot  # concurrency semaphore to release when done

    def run(self):
        try:
            self._handle_request()
        except Exception as exc:
            log.debug("Connection error from %s: %s", self.addr, exc)
        finally:
            try:
                self.conn.close()
            except Exception:
                pass
            if self.slot is not None:
                try:
                    self.slot.release()
                except (ValueError, RuntimeError):
                    pass

    # ── request dispatch ──────────────────────────────────────────────────────

    def _effective_rule(self, host: str) -> Optional[dict]:
        """Which rule, if any, applies to this host right now.

        Working hours gate both halves independently. Policy rules express the
        company's preferences about someone's browsing and stop at the end of
        the day; threat intelligence protects the machine and survives into
        security_only. When everything is paused nothing here applies — and the
        system proxy has been removed anyway, so this is the belt to that
        braces: an app with a hard-coded proxy setting still gets a clean
        passthrough rather than a block page in the employee's own time.
        """
        rule = self.cache.check(host) if GATE.enforces_policy() else None
        threat = (self.threats.check(host)
                  if self.threats is not None and GATE.checks_threat_intel() else None)
        if rule is not None and rule.get("action") == "block":
            return rule
        if threat is not None and threat.get("action") == "block":
            return threat
        return rule or threat

    def _casb_upload_verdict(self, host: str) -> Optional[dict]:
        if self.casb is None or not GATE.enforces_dlp():
            return None
        return self.casb.check(host, "upload")

    # Deliberately NOT named _handle: threading.Thread grew a private
    # `_handle` attribute (a _thread._ThreadHandle) in CPython 3.13, which
    # shadows a subclass method of that name. Calling it then raises
    # "'_thread._ThreadHandle' object is not callable" on every connection —
    # and because run() logs that at DEBUG, the proxy silently resets all
    # traffic instead of failing loudly.
    def _handle_request(self):
        data = self._recv_header()
        if not data:
            return

        first_line = data.split(b"\r\n")[0].decode("utf-8", errors="replace")
        parts = first_line.split()
        if len(parts) < 2:
            return

        method = parts[0].upper()
        if method == "CONNECT":
            self._handle_https(data)
        else:
            self._handle_http(data)

    # ── HTTPS tunnel (CONNECT) ────────────────────────────────────────────────

    def _handle_https(self, data: bytes):
        target = self._parse_connect_target(data)
        if not target:
            self.conn.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            return

        host, port = target
        rule = self._effective_rule(host)
        if rule is not None and rule.get("action") == "block":
            log.info("BLOCK https://%s (%s)", host, rule.get("reason", ""))
            self.reporter.record(f"https://{host}", host, "blocked", rule,
                                 kind="security" if rule.get("category") == "threat_intel" else "activity")

            # A bare non-200 response to CONNECT can't carry a page — the
            # browser treats it as "the tunnel itself failed"
            # (ERR_TUNNEL_CONNECTION_FAILED) rather than content, since no
            # TLS/HTTP session with the site exists yet at that point. The
            # only way to show our own block page for an HTTPS site is to
            # terminate TLS ourselves and serve it as that site's
            # "response" — which needs SSL Inspection on and a leaf cert
            # for this host. Falls back to the old bare-403 (ugly browser
            # error, but still blocked) when that isn't available.
            if self.mitm is not None and self.mitm.should_intercept(host):
                leaf = self.mitm.get_leaf(host)
                if leaf is not None:
                    self.conn.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                    self._serve_https_block_page(host, leaf, rule)
                    return

            self.conn.sendall(b"HTTP/1.1 403 Forbidden\r\n\r\n")
            return

        report_action = "alerted" if rule is not None and rule.get("action") == "alert" else "allowed"
        self.reporter.record(f"https://{host}", host, report_action, rule)
        self.conn.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")

        if self.mitm is not None and self.mitm.should_intercept(host):
            leaf = self.mitm.get_leaf(host)
            if leaf is not None:
                # Handled either way (success or a failed handshake) — see
                # _handle_mitm_tls for why there's no falling back to a blind
                # tunnel once this is attempted.
                self._handle_mitm_tls(host, port, leaf)
                return

        # Blind tunnel: SSL Inspection disabled/bypassed for this host, or no
        # leaf certificate could be obtained (e.g. admin-api unreachable).
        try:
            upstream = socket.create_connection((host, port), timeout=CONNECT_TIMEOUT)
        except OSError as exc:
            log.warning("Connect failed to %s:%d — %s", host, port, exc)
            return

        upstream.settimeout(None)  # tunnel may be long-lived / idle
        self._relay(self.conn, upstream)

    def _handle_mitm_tls(self, host: str, port: int, leaf: Tuple[str, str]):
        """Terminates TLS with the client using a leaf cert for host, opens
        a proper (fully-verified) TLS connection to the real upstream, and
        serves exactly one HTTP request/response transaction between them —
        same one-transaction-per-tunnel model _handle_http already uses for
        plain HTTP, so a browser reusing this tunnel for more requests just
        transparently opens a fresh CONNECT, which is normal, well-handled
        HTTP/1.1 behavior, not an error.

        Once the client-side handshake is attempted, this connection is
        committed: those bytes can't be un-consumed to fall back to a blind
        relay if something goes wrong. The two ways it can still legitimately
        fail here — the org's CA not yet trusted on this device (first boot,
        before the installer's trust-store step has run) and certificate
        pinning (some apps will never accept a substituted cert, which is
        exactly what the admin's SSL Inspection bypass list is for) — both
        just fail this one connection; nothing else on the device is
        affected.
        """
        certfile, keyfile = leaf
        try:
            server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            # Force HTTP/1.1: our request/response parsing is text-based
            # and has no idea how to speak HTTP/2's binary framing. Without
            # this, a client that offers h2 via ALPN may pick it if we
            # don't explicitly say otherwise, and our parser would just
            # hang trying to find a "\r\n\r\n" that will never appear.
            server_ctx.set_alpn_protocols(["http/1.1"])
            server_ctx.load_cert_chain(certfile=certfile, keyfile=keyfile)
            tls_client = server_ctx.wrap_socket(self.conn, server_side=True)
        except (ssl.SSLError, OSError) as exc:
            log.debug("MITM handshake with client failed for %s: %s", host, exc)
            return

        try:
            raw_upstream = socket.create_connection((host, port), timeout=CONNECT_TIMEOUT)
        except OSError as exc:
            log.debug("MITM upstream connect failed for %s: %s", host, exc)
            tls_client.close()
            return

        try:
            upstream_ctx = ssl.create_default_context()
            upstream_ctx.set_alpn_protocols(["http/1.1"])
            tls_upstream = upstream_ctx.wrap_socket(raw_upstream, server_hostname=host)
        except (ssl.SSLError, OSError) as exc:
            log.debug("MITM upstream TLS handshake failed for %s: %s", host, exc)
            tls_client.close()
            raw_upstream.close()
            return

        try:
            self._serve_over_tls(host, tls_client, tls_upstream)
        finally:
            tls_client.close()
            tls_upstream.close()

    def _serve_https_block_page(self, host: str, leaf: Tuple[str, str], rule: dict):
        """Terminates TLS using a leaf cert for host and serves the branded
        block page as the HTTPS response — no upstream connection is ever
        made, since the point is to keep the client from reaching host at
        all. This is what turns a domain block for an HTTPS site from a
        generic browser connection-error screen into our actual page."""
        certfile, keyfile = leaf
        try:
            server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_ctx.load_cert_chain(certfile=certfile, keyfile=keyfile)
            tls_client = server_ctx.wrap_socket(self.conn, server_side=True)
        except (ssl.SSLError, OSError) as exc:
            log.debug("Block-page TLS handshake failed for %s: %s", host, exc)
            return

        try:
            html = BLOCK_PAGE_HTML.format(
                domain=host,
                reason=rule.get("reason") or "Organization security policy",
                category=rule.get("category") or "Blocked",
            ).encode("utf-8")
            response = (
                b"HTTP/1.1 403 Forbidden\r\n"
                b"Content-Type: text/html; charset=utf-8\r\n"
                b"Content-Length: " + str(len(html)).encode() + b"\r\n"
                b"Connection: close\r\n\r\n" + html
            )
            tls_client.sendall(response)
        except (ssl.SSLError, OSError):
            pass
        finally:
            tls_client.close()

    def _serve_over_tls(self, host: str, client_sock: ssl.SSLSocket, upstream_sock: ssl.SSLSocket):
        """Serves requests over an already-MITM'd TLS connection, looping
        to keep BOTH legs alive across multiple sequential requests
        (HTTP keep-alive) instead of paying a fresh double TLS handshake
        (client + upstream) per resource — a page that loads dozens of
        resources (any modern webmail, e.g.) would otherwise multiply
        every one of those handshakes, which is exactly what made pages
        crawl once SSL Inspection was enabled.

        Reading the response body itself must use the length given by
        Content-Length or chunked framing, not "read until the socket
        closes" — a genuinely keep-alive upstream never closes, so that
        approach hangs the thread waiting for bytes that aren't coming
        until some external timeout eventually kills it. Falling back to
        read-until-close only happens when neither framing is present,
        and that case can't be kept alive afterwards either."""
        first = True
        while True:
            data = self._recv_header_from(client_sock, timeout=5 if first else KEEP_ALIVE_IDLE_TIMEOUT)
            first = False
            if not data:
                return

            url_path = self._request_path(data)
            method = self._request_method(data)

            # An upload is spooled, scanned, then streamed on — the body is
            # never held in memory, so upload size is bounded by scratch space
            # rather than by what the agent can allocate.
            forward_data = data
            upload_spool = None
            upload_size = 0
            if method in UPLOAD_METHODS:
                content_length = self._content_length(data)
                if content_length is not None:
                    headers_only, _, leftover_body = data.partition(b"\r\n\r\n")
                    upload_spool, upload_size = self._spool(
                        client_sock, max(0, content_length - len(leftover_body)), leftover_body)
                    if upload_spool is None:
                        return

                    casb_verdict = self._casb_upload_verdict(host)
                    if casb_verdict is not None and casb_verdict.get("action") == "block":
                        upload_spool.close()
                        self._send_dlp_block(client_sock, host, url_path, casb_verdict)
                        return

                    verdict = self._scan_upload_spooled(
                        host, url_path, headers_only, upload_spool, upload_size, method)
                    if verdict is not None and verdict.get("action") == "block":
                        upload_spool.close()
                        self._send_dlp_block(client_sock, host, url_path, verdict)
                        return

                    forward_data = headers_only + b"\r\n\r\n"

            try:
                upstream_sock.sendall(forward_data)
                if upload_spool is not None:
                    ok = self._relay_spool(upstream_sock, upload_spool, upload_size)
                    upload_spool.close()
                    upload_spool = None
                    if not ok:
                        return

                headers, leftover = self._recv_response_headers(upstream_sock)
                if headers is None:
                    return

                content_length = self._content_length(headers)
                chunked = self._is_chunked(headers)

                is_download = self._looks_like_download(headers, url_path)

                if is_download and content_length is not None:
                    spool, size = self._spool(
                        upstream_sock, max(0, content_length - len(leftover)), leftover)
                    if spool is None:
                        return
                    try:
                        self._relay_scanned_spool(client_sock, host, url_path, headers, spool, size)
                    finally:
                        spool.close()
                elif is_download and chunked:
                    spool, size = self._spool_chunked(upstream_sock, leftover)
                    if spool is None:
                        return
                    try:
                        self._relay_scanned_spool(client_sock, host, url_path, headers,
                                                  spool, size, rechunked=True)
                    finally:
                        spool.close()
                elif chunked:
                    client_sock.sendall(headers)
                    if not self._relay_chunked_body(upstream_sock, client_sock, leftover):
                        return
                elif content_length is not None:
                    client_sock.sendall(headers)
                    if leftover:
                        client_sock.sendall(leftover)
                    self._relay_exact(upstream_sock, client_sock, max(0, content_length - len(leftover)))
                else:
                    # No framing info at all — the only safe read is until
                    # the upstream closes, so this connection can't be
                    # reused for another request afterwards.
                    client_sock.sendall(headers)
                    if leftover:
                        client_sock.sendall(leftover)
                    while True:
                        chunk = upstream_sock.recv(65536)
                        if not chunk:
                            break
                        client_sock.sendall(chunk)
                    return
            except (ssl.SSLError, OSError):
                return

            if self._wants_close(data) or self._wants_close(headers):
                return

    @staticmethod
    def _recv_header_from(sock, timeout: float = 5) -> bytes:
        """Same header-read loop as _recv_header, generalized to any socket
        (raw or SSL-wrapped) rather than only self.conn, with a caller-
        chosen timeout — short for "is a request even coming", long for
        "waiting for the next request on an idle keep-alive connection"."""
        buf = b""
        sock.settimeout(timeout)
        try:
            while b"\r\n\r\n" not in buf:
                chunk = sock.recv(8192)
                if not chunk:
                    break
                buf += chunk
        except (socket.timeout, ssl.SSLError):
            pass
        finally:
            try:
                sock.settimeout(None)
            except OSError:
                pass
        return buf

    @staticmethod
    def _is_chunked(headers: bytes) -> bool:
        return b"transfer-encoding: chunked" in headers.lower()

    @staticmethod
    def _relay_exact(src, dst, remaining: int):
        """Reads exactly `remaining` bytes from src, streaming them to dst
        as they arrive rather than buffering the whole body in memory."""
        try:
            while remaining > 0:
                chunk = src.recv(min(65536, remaining))
                if not chunk:
                    return
                dst.sendall(chunk)
                remaining -= len(chunk)
        except OSError:
            pass

    @staticmethod
    def _relay_chunked_body(src, dst, leftover: bytes) -> bool:
        """Relays a chunked-encoded body from src to dst, passing the exact
        wire framing through unchanged (the client parses chunked encoding
        just as well as we do), stopping at the terminating 0-length chunk
        (plus any trailer headers). Returns True if the body was fully and
        cleanly relayed — meaning the connection can be kept alive for
        another request — or False on a read error / premature close."""
        buf = bytearray(leftover)

        def fill(satisfied) -> bool:
            while not satisfied(buf):
                chunk = src.recv(65536)
                if not chunk:
                    return False
                buf.extend(chunk)
            return True

        try:
            while True:
                if not fill(lambda b: b"\r\n" in b):
                    return False
                line_end = buf.index(b"\r\n")
                size_str = bytes(buf[:line_end]).split(b";", 1)[0].strip()
                try:
                    size = int(size_str, 16)
                except ValueError:
                    return False

                if size == 0:
                    # Terminal chunk: "0\r\n" + optional trailer headers,
                    # ending in a blank line.
                    if not fill(lambda b: b"\r\n\r\n" in b):
                        return False
                    end = buf.index(b"\r\n\r\n") + 4
                    dst.sendall(bytes(buf[:end]))
                    return True

                chunk_total = line_end + 2 + size + 2  # size-line + CRLF + data + CRLF
                if not fill(lambda b, n=chunk_total: len(b) >= n):
                    return False
                dst.sendall(bytes(buf[:chunk_total]))
                del buf[:chunk_total]
        except OSError:
            return False

    @staticmethod
    def _wants_close(headers: bytes) -> bool:
        text = headers.decode("utf-8", errors="replace").lower()
        first_line = text.split("\r\n", 1)[0]
        if "connection: close" in text:
            return True
        if "http/1.0" in first_line and "connection: keep-alive" not in text:
            return True
        return False

    @staticmethod
    def _parse_connect_target(data: bytes) -> Optional[Tuple[str, int]]:
        first_line = data.split(b"\r\n")[0].decode("utf-8", errors="replace")
        parts = first_line.split()
        if len(parts) < 2 or parts[0].upper() != "CONNECT":
            return None

        host_port = parts[1]
        if ":" in host_port:
            host, port_str = host_port.rsplit(":", 1)
            try:
                return host, int(port_str)
            except ValueError:
                return None
        return host_port, 443

    # ── Plain HTTP ────────────────────────────────────────────────────────────

    def _handle_http(self, data: bytes):
        target = self._parse_http_target(data)
        if not target:
            self.conn.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            return

        host, port, _ = target
        rule = self._effective_rule(host)
        if rule is not None and rule.get("action") == "block":
            log.info("BLOCK http://%s (%s)", host, rule.get("reason", ""))
            html = BLOCK_PAGE_HTML.format(
                domain=host,
                reason=rule.get("reason") or "Organization security policy",
                category=rule.get("category") or "Blocked",
            ).encode("utf-8")
            response = (
                b"HTTP/1.1 403 Forbidden\r\n"
                b"Content-Type: text/html; charset=utf-8\r\n"
                b"Content-Length: " + str(len(html)).encode() + b"\r\n"
                b"Connection: close\r\n\r\n" + html
            )
            self.conn.sendall(response)
            self.reporter.record(f"http://{host}", host, "blocked", rule)
            return

        report_action = "alerted" if rule is not None and rule.get("action") == "alert" else "allowed"
        self.reporter.record(f"http://{host}", host, report_action, rule)

        method = self._request_method(data)
        upload_spool = None
        upload_size = 0
        if method in UPLOAD_METHODS:
            content_length = self._content_length(data)
            if content_length is not None:
                headers_only, _, leftover_body = data.partition(b"\r\n\r\n")
                upload_spool, upload_size = self._spool(
                    self.conn, max(0, content_length - len(leftover_body)), leftover_body)
                if upload_spool is None:
                    return
                url_path = self._request_path(data)
                casb_verdict = self._casb_upload_verdict(host)
                if casb_verdict is not None and casb_verdict.get("action") == "block":
                    upload_spool.close()
                    self._send_dlp_block(self.conn, host, url_path, casb_verdict)
                    return
                verdict = self._scan_upload_spooled(
                    host, url_path, headers_only, upload_spool, upload_size, method)
                if verdict is not None and verdict.get("action") == "block":
                    upload_spool.close()
                    self._send_dlp_block(self.conn, host, url_path, verdict)
                    return
                data = headers_only + b"\r\n\r\n"

        try:
            upstream = socket.create_connection((host, port), timeout=CONNECT_TIMEOUT)
        except OSError as exc:
            log.warning("Direct HTTP connect failed to %s:%d — %s", host, port, exc)
            self.conn.sendall(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
            return

        try:
            upstream.settimeout(CONNECT_TIMEOUT)
            upstream.sendall(self._to_origin_form(data))
            if upload_spool is not None:
                self._relay_spool(upstream, upload_spool, upload_size)
                upload_spool.close()
                upload_spool = None

            headers, leftover = self._recv_response_headers(upstream)
            if headers is None:
                return

            url_path = self._request_path(data)
            content_length = self._content_length(headers)

            if self._looks_like_download(headers, url_path):
                spool = None
                if content_length is not None:
                    spool, size = self._spool(
                        upstream, max(0, content_length - len(leftover)), leftover)
                    rechunked = False
                elif self._is_chunked(headers):
                    spool, size = self._spool_chunked(upstream, leftover)
                    rechunked = True
                if spool is not None:
                    try:
                        self._relay_scanned_spool(self.conn, host, url_path, headers,
                                                  spool, size, rechunked=rechunked)
                    finally:
                        spool.close()
                    return

            upstream.settimeout(None)
            self.conn.sendall(headers)
            if leftover:
                self.conn.sendall(leftover)
            while True:
                chunk = upstream.recv(65536)
                if not chunk:
                    break
                self.conn.sendall(chunk)
        except OSError:
            pass
        finally:
            if upload_spool is not None:
                upload_spool.close()
            upstream.close()

    @staticmethod
    def _to_origin_form(data: bytes) -> bytes:
        """A proxied plain-HTTP request line arrives in absolute-form
        ("GET http://host/path HTTP/1.1") — that's correct client->proxy
        wire format, but real origin servers expect origin-form
        ("GET /path HTTP/1.1") and some (this was verified against Python's
        own http.server) 404 on anything else. Rewrite before relaying."""
        idx = data.find(b"\r\n")
        if idx == -1:
            return data
        parts = data[:idx].split(b" ")
        if len(parts) < 3 or not parts[1].startswith((b"http://", b"https://")):
            return data
        parsed = urllib.parse.urlparse(parts[1].decode("utf-8", errors="replace"))
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        new_first_line = parts[0] + b" " + path.encode("utf-8") + b" " + parts[2]
        return new_first_line + data[idx:]

    @staticmethod
    def _recv_response_headers(sock: socket.socket) -> Tuple[Optional[bytes], bytes]:
        """Reads until the end of the HTTP response header section. Returns
        (headers including the blank-line terminator, any body bytes already
        read past it) — or (None, b"") if the connection closed/errored, or
        the header section was absurdly large, before headers completed."""
        buf = b""
        try:
            while b"\r\n\r\n" not in buf:
                chunk = sock.recv(8192)
                if not chunk:
                    return None, b""
                buf += chunk
                if len(buf) > 1024 * 1024:
                    return None, b""
        except OSError:
            return None, b""
        idx = buf.index(b"\r\n\r\n") + 4
        return buf[:idx], buf[idx:]

    @staticmethod
    def _content_length(headers: bytes) -> Optional[int]:
        for line in headers.split(b"\r\n"):
            if line.lower().startswith(b"content-length:"):
                try:
                    return int(line.split(b":", 1)[1].strip())
                except ValueError:
                    return None
        return None

    @staticmethod
    def _request_method(data: bytes) -> str:
        parts = data.split(b"\r\n")[0].split()
        return parts[0].decode("ascii", "replace").upper() if parts else ""

    @staticmethod
    def _request_path(data: bytes) -> str:
        first_line = data.split(b"\r\n")[0].decode("utf-8", errors="replace")
        parts = first_line.split()
        if len(parts) < 2:
            return ""
        try:
            return urllib.parse.urlparse(parts[1]).path
        except ValueError:
            return parts[1]

    @staticmethod
    def _looks_like_download(headers: bytes, url_path: str) -> bool:
        header_text = headers.decode("utf-8", errors="replace").lower()
        if "content-disposition:" in header_text and "attachment" in header_text:
            return True
        if any(f"content-type: {ct}" in header_text for ct in SCAN_CONTENT_TYPES):
            return True
        path_lower = url_path.lower()
        return any(path_lower.endswith(ext) for ext in SCAN_EXTENSIONS)

    @staticmethod
    def _spool(sock, remaining: int, leftover: bytes):
        """Reads exactly `remaining` more bytes into a spooled temp file that
        already holds `leftover`. Returns (spool, size) with the spool rewound,
        or (None, 0) if the peer went away mid-body."""
        spool = tempfile.SpooledTemporaryFile(max_size=SPOOL_MEMORY)
        size = 0
        if leftover:
            spool.write(leftover)
            size = len(leftover)
        while remaining > 0:
            chunk = sock.recv(min(65536, remaining))
            if not chunk:
                spool.close()
                return None, 0
            spool.write(chunk)
            size += len(chunk)
            remaining -= len(chunk)
        spool.seek(0)
        return spool, size

    @staticmethod
    def _spool_chunked(sock, leftover: bytes):
        """Same, for a chunked body: de-chunks into a spool file so the content
        can be scanned. Chunked downloads used to be relayed unscanned, which
        made 'serve it chunked' a one-line bypass of file scanning."""
        spool = tempfile.SpooledTemporaryFile(max_size=SPOOL_MEMORY)
        buf = leftover
        size = 0
        while True:
            while b"\r\n" not in buf:
                more = sock.recv(65536)
                if not more:
                    spool.close()
                    return None, 0
                buf += more
            line, _, buf = buf.partition(b"\r\n")
            try:
                chunk_len = int(line.split(b";")[0].strip() or b"0", 16)
            except ValueError:
                spool.close()
                return None, 0
            if chunk_len == 0:
                # Trailer section, then the final CRLF.
                while b"\r\n\r\n" not in buf and not buf.startswith(b"\r\n"):
                    more = sock.recv(65536)
                    if not more:
                        break
                    buf += more
                break
            need = chunk_len + 2  # payload + trailing CRLF
            while len(buf) < need:
                more = sock.recv(65536)
                if not more:
                    spool.close()
                    return None, 0
                buf += more
            spool.write(buf[:chunk_len])
            size += chunk_len
            buf = buf[need:]
        spool.seek(0)
        return spool, size

    @staticmethod
    def _scan_deadline(size: int) -> float:
        return SCAN_TIMEOUT + size / SCAN_BYTES_PER_SECOND

    @staticmethod
    def _relay_spool(dst, spool, size: int) -> bool:
        """Streams a spooled body onward without materialising it."""
        spool.seek(0)
        sent = 0
        while sent < size:
            chunk = spool.read(65536)
            if not chunk:
                break
            try:
                dst.sendall(chunk)
            except OSError:
                return False
            sent += len(chunk)
        return True

    def _scan_file_spooled(self, spool, size: int, host: str, url_path: str,
                           headers: bytes) -> Optional[dict]:
        """Submits a downloaded file to admin-api's scanner by streaming the
        spool file, never the bytes. urllib sends a file object as the request
        body verbatim once Content-Length is set. Returns None (fail open) when
        the scanner can't be reached."""
        if not GATE.scans_downloads():
            return None
        filename = urllib.parse.unquote(urllib.parse.urlparse(url_path).path.rsplit("/", 1)[-1])
        query = urllib.parse.urlencode({
            "filename": filename,
            "content_type": self._header_value(headers, "content-type"),
            "destination": host,
        })
        spool.seek(0)
        try:
            req = _agent_request(
                self.cache.config,
                f"/internal/agent/scan-file?{query}",
                method="POST",
                body=spool,
            )
            req.add_header("Content-Length", str(size))
            req.add_header("Content-Type", "application/octet-stream")
            with _DIRECT_OPENER.open(req, timeout=self._scan_deadline(size)) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            log.debug("file scan failed for %s%s: %s", host, url_path, exc)
            return None

    def _relay_scanned_spool(self, client_sock, host: str, url_path: str, headers: bytes,
                             spool, size: int, rechunked: bool = False):
        """Scans a spooled download, then either blocks it or streams it on.

        When the body arrived chunked it is forwarded with an explicit
        Content-Length instead — we already have the whole thing, and the
        framing has to match what we actually send."""
        result = self._scan_file_spooled(spool, size, host, url_path, headers)
        out_headers = headers
        if rechunked:
            out_headers = self._replace_framing(headers, size)

        if result is None or not result.get("scanned"):
            client_sock.sendall(out_headers)
            self._relay_spool(client_sock, spool, size)
            return

        action = result.get("action") or ("block" if result.get("infected") else "allow")
        if action == "block":
            sig = result.get("signature") or result.get("reason") or "malware"
            log.info("MALWARE BLOCKED: %s%s (%s, %d bytes)", host, url_path, sig, size)
            reason = result.get("reason") or f"Malware detected in downloaded file: {sig}"
            html = BLOCK_PAGE_HTML.format(
                domain=host,
                reason=reason,
                category="Malware Detection",
            ).encode("utf-8")
            client_sock.sendall(
                b"HTTP/1.1 403 Forbidden\r\n"
                b"Content-Type: text/html; charset=utf-8\r\n"
                b"Content-Length: " + str(len(html)).encode() + b"\r\n"
                b"Connection: close\r\n\r\n" + html
            )
            return

        client_sock.sendall(out_headers)
        self._relay_spool(client_sock, spool, size)

    @staticmethod
    def _replace_framing(headers: bytes, size: int) -> bytes:
        """Swaps Transfer-Encoding: chunked for a Content-Length — a proxy may
        re-frame a body it has fully buffered, and it must, since we de-chunked
        it to scan it."""
        lines = headers.split(b"\r\n")
        kept = [ln for ln in lines
                if ln and not ln.lower().startswith((b"transfer-encoding:", b"content-length:"))]
        kept.append(b"Content-Length: " + str(size).encode())
        return b"\r\n".join(kept) + b"\r\n\r\n"

    # ── DLP (upload scanning) ─────────────────────────────────────────────────

    @staticmethod
    def _header_value(headers: bytes, name: str) -> str:
        prefix = (name + ":").lower().encode()
        for line in headers.split(b"\r\n"):
            if line.lower().startswith(prefix):
                return line.split(b":", 1)[1].strip().decode("utf-8", errors="replace")
        return ""

    @classmethod
    def _upload_filename(cls, headers: bytes, url_path: str) -> str:
        disposition = cls._header_value(headers, "content-disposition")
        if "filename=" in disposition:
            name = disposition.split("filename=", 1)[1].strip().strip('"').strip("'")
            if name:
                return name
        return url_path.rsplit("/", 1)[-1] or ""

    def _scan_upload_spooled(self, host: str, url_path: str, headers: bytes, spool, size: int,
                             method: str = "") -> Optional[dict]:
        """Submits an outbound request body to admin-api's DLP scanner,
        streamed from the spool file. Returns None (treated as allow — fail
        open) if the scanner can't be reached; otherwise the verdict dict."""
        if not GATE.enforces_dlp():
            return None
        query = urllib.parse.urlencode({
            "filename": self._upload_filename(headers, url_path),
            "content_type": self._header_value(headers, "content-type"),
            "destination": host,
            "method": method,
            "path": url_path,
        })
        spool.seek(0)
        try:
            req = _agent_request(self.cache.config, f"/internal/agent/scan-dlp?{query}",
                                 method="POST", body=spool)
            req.add_header("Content-Length", str(size))
            req.add_header("Content-Type", "application/octet-stream")
            with _DIRECT_OPENER.open(req, timeout=self._scan_deadline(size)) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            log.debug("upload scan failed for %s%s: %s", host, url_path, exc)
            return None

    def _send_dlp_block(self, client_sock, host: str, url_path: str, verdict: dict):
        reason = verdict.get("reason") or "Sensitive company data detected"
        log.info("DLP BLOCKED: upload to %s%s (%s)", host, url_path, reason)
        html = BLOCK_PAGE_HTML.format(
            domain=host,
            reason=reason,
            category="Data Loss Prevention",
        ).encode("utf-8")
        response = (
            b"HTTP/1.1 403 Forbidden\r\n"
            b"Content-Type: text/html; charset=utf-8\r\n"
            b"Content-Length: " + str(len(html)).encode() + b"\r\n"
            b"Connection: close\r\n\r\n" + html
        )
        try:
            client_sock.sendall(response)
        except (ssl.SSLError, OSError):
            pass

    @staticmethod
    def _parse_http_target(data: bytes) -> Optional[Tuple[str, int, bool]]:
        first_line = data.split(b"\r\n")[0].decode("utf-8", errors="replace")
        parts = first_line.split()
        if len(parts) < 2:
            return None

        url = parts[1]
        if url.startswith(("http://", "https://")):
            parsed = urllib.parse.urlparse(url)
            if not parsed.hostname:
                return None
            if parsed.scheme == "https":
                port = parsed.port or 443
            else:
                port = parsed.port or 80
            return parsed.hostname, port, parsed.scheme == "https"

        # Origin-form request (no absolute URL) — fall back to the Host header.
        host_header = None
        for line in data.split(b"\r\n")[1:]:
            if line.lower().startswith(b"host:"):
                host_header = line.split(b":", 1)[1].strip().decode("utf-8", errors="replace")
                break
        if not host_header:
            return None
        if ":" in host_header:
            host, port_str = host_header.rsplit(":", 1)
            try:
                return host, int(port_str), False
            except ValueError:
                return None
        return host_header, 80, False

    # ── Bidirectional relay ───────────────────────────────────────────────────

    @staticmethod
    def _relay(a: socket.socket, b: socket.socket):
        def copy(src: socket.socket, dst: socket.socket):
            try:
                while True:
                    chunk = src.recv(65536)
                    if not chunk:
                        break
                    dst.sendall(chunk)
            except OSError:
                pass
            finally:
                try:
                    dst.shutdown(socket.SHUT_WR)
                except OSError:
                    pass

        # Run one direction in a helper thread and the other in THIS thread, so
        # an active tunnel costs 2 threads (handler + 1 helper), not 3. With
        # system-wide proxying every app's connections land here, so halving the
        # thread count materially reduces the risk of "can't start new thread".
        t = threading.Thread(target=copy, args=(a, b), daemon=True)
        t.start()
        copy(b, a)
        t.join()

        # Close BOTH sockets once the tunnel is done. Without this the upstream
        # socket fd leaks on every HTTPS/CONNECT request; under macOS launchd's
        # low file-descriptor limit the agent quickly dies with
        # "[Errno 24] Too many open files" and crash-loops.
        for s in (a, b):
            try:
                s.close()
            except OSError:
                pass

    # ── Socket helpers ────────────────────────────────────────────────────────

    def _recv_header(self) -> bytes:
        """Read until we have the full HTTP header section."""
        buf = b""
        self.conn.settimeout(5)
        try:
            while b"\r\n\r\n" not in buf:
                chunk = self.conn.recv(8192)
                if not chunk:
                    break
                buf += chunk
        except socket.timeout:
            pass
        finally:
            self.conn.settimeout(None)
        return buf


# ─── Time-and-activity monitoring (screenshots + activity) ────────────────────

class ScreenshotConfig:
    """Whether to capture and how often — pushed by the server on the heartbeat.

    The "when" is not here: that is the enforcement gate's job (working hours).
    This only says whether the company turned screenshots on at all and the
    random-interval bounds. Off by default; the capturer stays dormant until an
    admin enables it.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self.enabled = False
        self.min_interval = 60
        self.max_interval = 420
        self.blur = False

    def apply(self, payload: Optional[dict]):
        if not isinstance(payload, dict):
            return
        with self._lock:
            self.enabled = bool(payload.get("enabled"))
            self.min_interval = max(20, int(payload.get("min_interval_seconds") or 60))
            self.max_interval = max(self.min_interval, int(payload.get("max_interval_seconds") or 420))
            self.blur = bool(payload.get("blur"))

    def snapshot(self):
        with self._lock:
            return self.enabled, self.min_interval, self.max_interval, self.blur


SCREENSHOT = ScreenshotConfig()


class ActivityMonitor:
    """Counts keyboard, mouse and scroll input so each screenshot can carry an
    activity level — the percentage of seconds in the interval that saw any
    input, exactly what TeamLogger shows under each thumbnail.

    Input monitoring needs an OS permission (Input Monitoring / Accessibility
    on macOS, none on Windows, an X server on Linux). If the listener can't
    start, activity simply reports zero rather than the agent failing — the
    screenshots are still useful on their own.

    It only *observes*: no key contents are recorded, only that a key was
    pressed. Counting, never logging keystrokes.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._active_seconds = set()   # wall-clock int seconds that saw input
        self._keyboard = 0
        self._mouse = 0
        self._scroll = 0
        self._last_move = 0.0
        self._listeners = []
        self._available = False

    def start(self):
        try:
            from pynput import keyboard, mouse  # noqa: PLC0415
        except Exception as exc:  # noqa: BLE001 - missing dep or backend
            log.info("activity monitoring unavailable (pynput not usable: %s)", exc)
            return

        def mark():
            with self._lock:
                self._active_seconds.add(int(time.time()))
                # Keep memory bounded — an hour of seconds is plenty for any
                # interval we compute over.
                if len(self._active_seconds) > 4000:
                    cutoff = int(time.time()) - 3600
                    self._active_seconds = {s for s in self._active_seconds if s >= cutoff}

        def on_key(_k):
            with self._lock:
                self._keyboard += 1
            mark()

        def on_click(_x, _y, _b, pressed):
            if pressed:
                with self._lock:
                    self._mouse += 1
                mark()

        def on_scroll(_x, _y, _dx, _dy):
            with self._lock:
                self._scroll += 1
            mark()

        def on_move(_x, _y):
            # Movement fires torrentially; throttle to at most one "active"
            # mark per second so a still cursor never counts and a moving one
            # doesn't drown the counters.
            now = time.time()
            if now - self._last_move >= 1.0:
                self._last_move = now
                with self._lock:
                    self._mouse += 1
                mark()

        try:
            kl = keyboard.Listener(on_press=on_key)
            ml = mouse.Listener(on_click=on_click, on_scroll=on_scroll, on_move=on_move)
            kl.daemon = True
            ml.daemon = True
            kl.start()
            ml.start()
            self._listeners = [kl, ml]
            self._available = True
            log.info("activity monitoring started")
        except Exception as exc:  # noqa: BLE001
            log.info("activity monitoring could not start: %s", exc)

    def snapshot(self, since_ts: float, until_ts: float) -> dict:
        """Activity over [since_ts, until_ts]. active_seconds is how many whole
        seconds in the window saw input; percent is that over the window."""
        start_s = int(since_ts)
        end_s = int(until_ts)
        total = max(1, end_s - start_s)
        with self._lock:
            active = sum(1 for sec in self._active_seconds if start_s <= sec < end_s)
            kb, mo, sc = self._keyboard, self._mouse, self._scroll
            # Reset the running counters so the next snapshot is a delta.
            self._keyboard = self._mouse = self._scroll = 0
        percent = min(100, int(round(active * 100.0 / total)))
        return {
            "active_seconds": active,
            "interval_seconds": total,
            "activity_percent": percent,
            "keyboard": kb,
            "mouse": mo,
            "scroll": sc,
        }


def _capture_screen(blur: bool) -> Optional[Tuple[bytes, int, int]]:
    """Grabs the primary screen and returns (webp_bytes, width, height), or
    None if screen capture isn't available (no permission, headless, missing
    library). WebP keeps a full desktop under ~150KB.

    macOS needs Screen Recording permission; the first capture attempt is what
    triggers the system prompt. Until granted, capture returns None and the
    agent simply records nothing rather than crashing.
    """
    try:
        from PIL import Image, ImageFilter  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        return None

    img = None
    try:
        import mss  # noqa: PLC0415

        with mss.mss() as sct:
            shot = sct.grab(sct.monitors[0])  # all-monitors bounding box
            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    except Exception:  # noqa: BLE001 - fall back to PIL's own grabber
        try:
            from PIL import ImageGrab  # noqa: PLC0415

            img = ImageGrab.grab()
        except Exception as exc:  # noqa: BLE001
            log.debug("screen capture unavailable: %s", exc)
            return None

    if img is None:
        return None

    width, height = img.size
    # Cap the long edge so a Retina/4K desktop doesn't produce a huge file; the
    # detail needed to see what someone was doing survives 1600px comfortably.
    max_edge = 1600
    if max(width, height) > max_edge:
        scale = max_edge / float(max(width, height))
        img = img.resize((int(width * scale), int(height * scale)), Image.LANCZOS)

    if blur:
        img = img.filter(ImageFilter.GaussianBlur(8))

    import io as _io  # noqa: PLC0415
    buf = _io.BytesIO()
    img.save(buf, format="WEBP", quality=55, method=4)
    return buf.getvalue(), width, height


class ScreenshotCapturer:
    """Drives capture: opens a work session when monitoring is live, then loops
    taking a screenshot at a random point in the configured interval, tagging
    each with the activity measured since the previous one, and uploading it.

    Every layer of gating is respected. Nothing is captured unless the org
    enabled screenshots AND the enforcement gate says full — so a personal
    laptop outside working hours, or any device while paused, produces nothing.
    """

    def __init__(self, config: dict, activity: "ActivityMonitor"):
        self.config = config
        self.activity = activity
        self._session_id: Optional[str] = None
        self._last_capture = time.time()

    def loop(self):
        while True:
            enabled, lo, hi, blur = SCREENSHOT.snapshot()
            live = enabled and GATE.captures_screenshots()

            if not live:
                # Monitoring is off (disabled, paused, or off-hours). Close any
                # open session so the dashboard shows a clean "ended", and idle.
                self._end_session()
                time.sleep(10)
                continue

            self._start_session()

            # Wait a random slice of the interval, but come back often enough to
            # notice the gate flipping to paused mid-wait.
            wait = random.randint(lo, hi)
            waited = 0
            while waited < wait:
                time.sleep(min(5, wait - waited))
                waited += 5
                if not (SCREENSHOT.snapshot()[0] and GATE.captures_screenshots()):
                    break
            else:
                self._capture(blur)

    def _capture(self, blur: bool):
        shot = _capture_screen(blur)
        if shot is None:
            return
        data, width, height = shot
        now = time.time()
        stats = self.activity.snapshot(self._last_capture, now)
        self._last_capture = now

        params = {
            "session_id": self._session_id or "",
            "captured_at": _rfc3339(now),
            "interval_start": _rfc3339(now - stats["interval_seconds"]),
            "interval_end": _rfc3339(now),
            "width": str(width),
            "height": str(height),
            "content_type": "image/webp",
            **{k: str(v) for k, v in stats.items()},
        }
        query = urllib.parse.urlencode(params)
        try:
            req = _agent_request(self.config, f"/internal/agent/screenshot?{query}",
                                 method="POST", body=data)
            req.add_header("Content-Type", "application/octet-stream")
            req.add_header("Content-Length", str(len(data)))
            with _DIRECT_OPENER.open(req, timeout=30) as resp:
                json.loads(resp.read().decode("utf-8") or "{}")
            log.debug("screenshot uploaded (%d bytes, %d%% active)", len(data), stats["activity_percent"])
        except (urllib.error.URLError, OSError, ValueError) as exc:
            mark_revoked_if_auth_error(exc)
            log.debug("screenshot upload failed: %s", exc)

    def _start_session(self):
        if self._session_id is not None:
            return
        payload = json.dumps({
            "hostname": socket.gethostname(),
            "started_at": _rfc3339(time.time()),
        }).encode()
        try:
            req = _agent_request(self.config, "/internal/agent/session/start",
                                 method="POST", body=payload)
            with _DIRECT_OPENER.open(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8") or "{}")
            self._session_id = data.get("session_id")
            self._last_capture = time.time()
            log.info("work session started")
        except (urllib.error.URLError, OSError, ValueError) as exc:
            mark_revoked_if_auth_error(exc)
            log.debug("could not start session: %s", exc)

    def _end_session(self):
        if self._session_id is None:
            return
        payload = json.dumps({"session_id": self._session_id, "ended_at": _rfc3339(time.time())}).encode()
        try:
            req = _agent_request(self.config, "/internal/agent/session/end",
                                 method="POST", body=payload)
            with _DIRECT_OPENER.open(req, timeout=15):
                pass
            log.info("work session ended")
        except (urllib.error.URLError, OSError):
            pass
        finally:
            self._session_id = None


def _rfc3339(ts: float) -> str:
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ─── Heartbeat ────────────────────────────────────────────────────────────────

def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return ""


def get_mac_address() -> str:
    try:
        node = uuid.getnode()
        # uuid.getnode may return a random multicast node if no hardware MAC
        # can be discovered. Do not report that as a stable device identity.
        if (node >> 40) & 1:
            return ""
        return ":".join(f"{(node >> shift) & 0xff:02x}" for shift in range(40, -1, -8))
    except Exception:
        return ""


def _probe(cmd: List[str], timeout: float = 3.0) -> Optional[str]:
    """Best-effort command runner for posture probes — returns stdout on
    success, None on any failure/timeout/missing binary. Never raises, so a
    posture probe can't break the heartbeat.

    Deliberately not named _run: the proxy-control section defines its own
    _run returning (rc, output), and because that definition comes later in
    the file it shadowed this one at import time — every posture probe was
    silently comparing a tuple against a string and reporting False.
    """
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if out.returncode == 0:
            return (out.stdout or "") + (out.stderr or "")
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def collect_posture() -> dict:
    """Collect device posture signals, best-effort. Each field is True / False
    / None(unknown); the server scores None as a partial penalty."""
    system = platform.system().lower()
    signals: Dict[str, Optional[bool]] = {
        "disk_encryption": None,
        "firewall": None,
        "os_up_to_date": None,
        "screen_lock": None,
        "antivirus": None,
    }

    if system == "darwin":
        fv = _probe(["fdesetup", "status"])
        if fv is not None:
            signals["disk_encryption"] = "FileVault is On" in fv
        fw = _probe(["/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate"])
        if fw is not None:
            signals["firewall"] = "enabled" in fw.lower()
        lock = _probe(["defaults", "read", "com.apple.screensaver", "askForPassword"])
        if lock is not None:
            signals["screen_lock"] = lock.strip() == "1"

    elif system == "linux":
        lsblk = _probe(["lsblk", "-o", "TYPE"])
        if lsblk is not None:
            signals["disk_encryption"] = "crypt" in lsblk
        ufw = _probe(["ufw", "status"])
        if ufw is not None:
            signals["firewall"] = "Status: active" in ufw
        elif (fw := _probe(["systemctl", "is-active", "firewalld"])) is not None:
            signals["firewall"] = fw.strip() == "active"

    elif system == "windows":
        fw = _probe(["netsh", "advfirewall", "show", "allprofiles", "state"])
        if fw is not None:
            signals["firewall"] = "ON" in fw.upper()

    return signals


def send_heartbeat(config: dict):
    payload = json.dumps({
        "status":     "online",
        "ip_address": get_local_ip(),
        "mac_address": get_mac_address(),
        "proxy_port": LOCAL_PORT,
        "os_type":    platform.system().lower(),
        "os_version": platform.version(),
        # Resent on every beat, not just at enrolment: after an auto-update or
        # a reinstall the device row would otherwise report the version it
        # first enrolled with forever, which is exactly the wrong answer when
        # you are trying to see which machines have picked up a fix.
        "agent_version": AGENT_VERSION,
        "posture":    collect_posture(),
    }).encode()

    req = _agent_request(config, "/internal/agent/heartbeat", method="POST", body=payload)
    try:
        with _DIRECT_OPENER.open(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8") or "{}")
        log.debug("Heartbeat sent")
    except (urllib.error.URLError, ValueError) as exc:
        mark_revoked_if_auth_error(exc)
        log.warning("Heartbeat failed: %s", exc)
        return

    # The working-hours verdict rides the heartbeat: no extra poll, and it
    # arrives with the server's own clock to anchor against.
    changed = GATE.apply(body.get("enforcement"), body.get("server_time"))
    if changed:
        apply_enforcement_transition(changed)
    SCREENSHOT.apply(body.get("screenshots"))


def seed_enforcement(config: dict):
    """One-shot fetch of the working-hours verdict at startup.

    Fails open to "enforcing": if the server can't be reached we cannot know a
    schedule exists, and the safe default for an unknown device is the same as
    for a company laptop — enforce. The first successful heartbeat corrects it
    within a minute.
    """
    try:
        req = _agent_request(config, "/internal/agent/config")
        with _DIRECT_OPENER.open(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8") or "{}")
    except (urllib.error.URLError, OSError, ValueError) as exc:
        mark_revoked_if_auth_error(exc)
        log.debug("could not read enforcement state at startup: %s", exc)
        return
    GATE.apply(body.get("enforcement"))
    SCREENSHOT.apply(body.get("screenshots"))


def heartbeat_loop(config: dict):
    while True:
        send_heartbeat(config)
        time.sleep(HEARTBEAT_INTERVAL)


# ─── Proxy server ─────────────────────────────────────────────────────────────

def run_proxy(cache: PolicyCache, reporter: ActivityReporter, threats: ThreatIntelCache,
              casb: CASBControlCache, mitm: Optional[MITMEngine] = None):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind(("127.0.0.1", LOCAL_PORT))
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            log.error(
                "Port %d is already in use — another aavishield-agent process is likely "
                "still running. Find it with `lsof -i :%d` and stop it, then retry.",
                LOCAL_PORT, LOCAL_PORT,
            )
        raise
    server.listen(256)
    log.info("Aavishield agent proxy listening on 127.0.0.1:%d", LOCAL_PORT)

    # Bounds the number of concurrent client connections (and therefore threads).
    # When the cap is reached, accept() pauses — new connections queue in the
    # listen backlog instead of spawning unbounded threads and crashing.
    slots = threading.BoundedSemaphore(MAX_CONCURRENT_CONNS)

    while True:
        try:
            conn, addr = server.accept()
        except OSError as exc:
            # Transient resource exhaustion (too many open files / connections)
            # must NOT tear down the whole proxy — that would black-hole every
            # site. Log, back off briefly, and keep serving.
            if exc.errno in (errno.EMFILE, errno.ENFILE, errno.ECONNABORTED):
                log.warning("Transient accept error (%s) — backing off", exc)
                time.sleep(0.1)
                continue
            log.error("Accept error: %s", exc)
            break

        slots.acquire()
        try:
            ProxyConnection(conn, addr, cache, reporter, threats=threats, casb=casb, mitm=mitm, slot=slots).start()
        except RuntimeError as exc:
            # Could not spawn a worker thread — drop THIS connection, keep serving.
            log.warning("Could not start worker thread (%s) — dropping connection", exc)
            slots.release()
            try:
                conn.close()
            except OSError:
                pass


# ─── Graceful shutdown ────────────────────────────────────────────────────────

def report_offline(config: dict):
    req = _agent_request(config, "/internal/agent/offline", method="POST", body=b"{}")
    try:
        with _DIRECT_OPENER.open(req, timeout=5):
            pass
    except Exception:
        pass


# ─── Entry point ──────────────────────────────────────────────────────────────

def raise_fd_limit():
    """
    Once the system-wide proxy is on, EVERY app's traffic flows through this
    agent. The macOS launchd default soft limit (256 fds) is exhausted almost
    instantly under that load, so raise it as high as the hard limit allows.
    """
    if resource is None:
        return
    try:
        soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        target = hard if hard != resource.RLIM_INFINITY else 65536
        if soft < target:
            resource.setrlimit(resource.RLIMIT_NOFILE, (target, hard))
            log.info("Raised open-file limit: %s -> %s", soft, target)
    except (ValueError, OSError) as exc:
        log.warning("Could not raise open-file limit: %s", exc)


# ─── System proxy control ─────────────────────────────────────────────────────
#
# The packaged installers no longer own this: the agent points the OS at itself
# on startup and re-arms it if someone turns it off, so a user toggling the
# proxy in system settings no longer silently drops out of policy.

def _run(cmd: List[str]) -> Tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except (subprocess.SubprocessError, OSError) as exc:
        return 1, str(exc)


def _macos_network_services() -> List[str]:
    rc, out = _run(["networksetup", "-listallnetworkservices"])
    if rc != 0:
        return []
    return [ln.strip() for ln in out.splitlines()[1:] if ln.strip() and not ln.startswith("*")]


def system_proxy_active() -> bool:
    """True when the OS is currently routing through this agent."""
    port = str(LOCAL_PORT)
    system = platform.system()
    try:
        if system == "Darwin":
            for svc in _macos_network_services():
                rc, out = _run(["networksetup", "-getwebproxy", svc])
                if rc == 0 and "Enabled: Yes" in out and port in out:
                    return True
            return False
        if system == "Windows":
            import winreg  # noqa: PLC0415 - Windows-only, imported lazily
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            )
            try:
                enabled, _ = winreg.QueryValueEx(key, "ProxyEnable")
                server, _ = winreg.QueryValueEx(key, "ProxyServer")
                return bool(enabled) and port in str(server)
            finally:
                winreg.CloseKey(key)
        rc, out = _run(["gsettings", "get", "org.gnome.system.proxy", "mode"])
        return rc == 0 and "manual" in out
    except Exception as exc:  # noqa: BLE001 - never let a probe kill the agent
        log.debug("proxy probe failed: %s", exc)
        return False


def clear_system_proxy() -> bool:
    """Points the OS back at a direct connection.

    This is what makes "paused" safe on a personal laptop: leaving the proxy
    armed while the agent stops serving would break every request on the
    machine. Deliberately not the same as the uninstall path — the agent stays
    installed and enrolled, it just isn't in the traffic path.
    """
    system = platform.system()
    try:
        if system == "Darwin":
            for svc in _macos_network_services():
                _run(["networksetup", "-setwebproxystate", svc, "off"])
                _run(["networksetup", "-setsecurewebproxystate", svc, "off"])
            return True
        if system == "Windows":
            import winreg  # noqa: PLC0415

            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                0, winreg.KEY_SET_VALUE,
            )
            try:
                winreg.SetValueEx(key, "ProxyEnable", 0, winreg.REG_DWORD, 0)
            finally:
                winreg.CloseKey(key)
            return True
        _run(["gsettings", "set", "org.gnome.system.proxy", "mode", "none"])
        return True
    except Exception as exc:  # noqa: BLE001 - never let this kill the caller
        log.warning("Could not clear the system proxy: %s", exc)
        return False


def apply_system_proxy() -> bool:
    """Point the OS at this agent. Returns True if it looks applied."""
    port = str(LOCAL_PORT)
    system = platform.system()
    try:
        if system == "Darwin":
            applied = False
            for svc in _macos_network_services():
                _run(["networksetup", "-setwebproxy", svc, "127.0.0.1", port])
                _run(["networksetup", "-setwebproxystate", svc, "on"])
                _run(["networksetup", "-setsecurewebproxy", svc, "127.0.0.1", port])
                _run(["networksetup", "-setsecurewebproxystate", svc, "on"])
                _run(["networksetup", "-setproxybypassdomains", svc,
                      "localhost", "127.0.0.1", "*.local", "169.254/16", "fe80::/10"])
                applied = True
            return applied
        if system == "Windows":
            import winreg  # noqa: PLC0415
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                0, winreg.KEY_SET_VALUE,
            )
            try:
                winreg.SetValueEx(key, "ProxyServer", 0, winreg.REG_SZ, f"127.0.0.1:{port}")
                winreg.SetValueEx(key, "ProxyEnable", 0, winreg.REG_DWORD, 1)
                winreg.SetValueEx(key, "ProxyOverride", 0, winreg.REG_SZ, "localhost;127.0.0.1;<local>")
            finally:
                winreg.CloseKey(key)
            return True
        for schema, key_, val in [
            ("org.gnome.system.proxy", "mode", "manual"),
            ("org.gnome.system.proxy.http", "host", "127.0.0.1"),
            ("org.gnome.system.proxy.http", "port", port),
            ("org.gnome.system.proxy.https", "host", "127.0.0.1"),
            ("org.gnome.system.proxy.https", "port", port),
        ]:
            _run(["gsettings", "set", schema, key_, val])
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("could not apply system proxy: %s", exc)
        return False


class ProxyWatchdog:
    """
    Re-arms the system proxy when it gets turned off.

    Honest limitation: this runs with the employee's own privileges, so it is a
    deterrent against casual "turn it off in settings", not real tamper
    protection — a determined user can stop the service. Defeating that needs a
    root/SYSTEM daemon or the native connector (option C).
    """

    def __init__(self, config: dict, reporter: "ActivityReporter"):
        self.config = config
        self.reporter = reporter

    def loop(self):
        while True:
            time.sleep(WATCHDOG_INTERVAL)
            try:
                # Outside working hours the proxy is *supposed* to be off. Without
                # this check the watchdog would re-arm it within 30 seconds and
                # silently undo the pause — and report the employee for tampering
                # while doing it.
                if not GATE.intercepts():
                    if system_proxy_active():
                        log.info("proxy still armed while paused — clearing")
                        clear_system_proxy()
                    continue
                if system_proxy_active():
                    continue
                log.warning("system proxy is off — re-arming")
                if apply_system_proxy():
                    self._report_tamper()
            except Exception as exc:  # noqa: BLE001
                log.debug("watchdog iteration failed: %s", exc)

    def _report_tamper(self):
        try:
            self.reporter.record(
                "system-proxy",
                "",
                "alerted",
                {
                    "category": "tamper_attempt",
                    "reason": "Agent proxy was disabled and automatically re-enabled",
                    "risk_score": 60,
                },
                event_type="policy_violation",
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("could not report tamper event: %s", exc)


# ─── Enrollment ───────────────────────────────────────────────────────────────

def _find_enroll_token() -> Tuple[Optional[str], Optional[str]]:
    """Locate an enrollment token from env or an MDM/installer-dropped file."""
    token = os.environ.get(ENROLL_TOKEN_ENV)
    admin = os.environ.get(ENROLL_ADMIN_ENV)
    if token:
        return token.strip(), (admin or "").strip() or None

    for path in ENROLL_DROP_PATHS:
        try:
            if not os.path.exists(path):
                continue
            with open(path) as f:
                data = json.load(f)
            tok = (data.get("token") or "").strip()
            if tok:
                return tok, (data.get("admin_url") or "").strip() or None
        except (OSError, ValueError) as exc:
            log.warning("ignoring unreadable enrollment drop %s: %s", path, exc)
    return None, None


def enroll(token: str, admin_url: str) -> dict:
    """Exchange an enrollment token for device credentials and write config."""
    payload = json.dumps({
        "token": token,
        "hostname": socket.gethostname(),
        "os_type": {"Darwin": "darwin", "Windows": "windows"}.get(platform.system(), "linux"),
        "os_version": platform.release(),
        "mac_address": get_mac_address(),
        "agent_version": AGENT_VERSION,
    }).encode()

    req = urllib.request.Request(
        f"{admin_url.rstrip('/')}/internal/agent/enroll",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": f"AavishieldAgent/{AGENT_VERSION}"},
    )
    with _DIRECT_OPENER.open(req, timeout=30) as resp:
        body = json.load(resp)

    config = {
        "device_id":   body["device_id"],
        "agent_key":   body["agent_key"],
        "org_id":      body["org_id"],
        "employee_id": body.get("employee_id") or "",
        "admin_url":   admin_url.rstrip("/"),
        "local_port":  LOCAL_PORT,
    }
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
    os.chmod(CONFIG_PATH, 0o600)
    log.info("Enrolled successfully as device %s", config["device_id"])
    return config


def _discard_enroll_drops():
    """Leaving a live enrollment token sitting on disk would let anyone who can
    read the file enroll another device as this employee."""
    for path in ENROLL_DROP_PATHS:
        try:
            if os.path.exists(path):
                os.remove(path)
                log.info("removed enrollment drop %s", path)
        except OSError as exc:
            log.warning("could not remove enrollment drop %s: %s", path, exc)


def ensure_enrolled() -> Optional[dict]:
    """Return an existing config, or enroll if a token was supplied."""
    if os.path.exists(CONFIG_PATH):
        return load_config()

    token, admin_url = _find_enroll_token()
    if not token:
        return None

    admin_url = admin_url or os.environ.get(ENROLL_ADMIN_ENV) or DEFAULT_ADMIN_URL
    if not admin_url:
        log.error("enrollment token found but no admin URL — set %s", ENROLL_ADMIN_ENV)
        return None

    try:
        config = enroll(token, admin_url)
    except Exception as exc:  # noqa: BLE001 - surface the reason, don't crash the service
        log.error("enrollment failed: %s", exc)
        return None

    _discard_enroll_drops()
    return config


# ─── First-run browser enrollment ─────────────────────────────────────────────
#
# A notarized package is byte-identical for every employee, so it cannot carry
# the token that says who this device belongs to — changing a single byte
# invalidates the signature. Rather than making somebody paste that token by
# hand, an agent that starts with no config opens the employee portal and waits
# here for the portal to hand it back over loopback.
#
# The one-time `state` string is the whole security story: it exists only in
# the URL this process opened, so a POST that quotes it back came from the page
# we sent the employee to, and no other page the browser happens to have open
# can silently enrol this device.


def _open_in_browser(url: str) -> bool:
    try:
        if platform.system() == "Darwin":
            subprocess.run(["/usr/bin/open", url], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        import webbrowser  # noqa: PLC0415 - only needed on this path
        return webbrowser.open(url)
    except (OSError, subprocess.CalledProcessError) as exc:
        log.warning("could not open a browser for enrollment: %s", exc)
        return False


def _enroll_callback_handler(state: str, portal_origin: str, result: dict,
                             done: threading.Event, enroll_url: str):
    """Builds the request handler class for the loopback callback listener."""
    from http.server import BaseHTTPRequestHandler  # noqa: PLC0415

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # noqa: A003 - silence stderr spam
            log.debug("enroll callback: " + fmt, *args)

        def _cors(self):
            origin = self.headers.get("Origin") or ""
            if origin == portal_origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                # Chrome's Private Network Access check: a page on a public
                # origin may only reach loopback if the preflight says so.
                # Without this the portal's POST never leaves the browser.
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

        def _json(self, code: int, payload: dict):
            body = json.dumps(payload).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):  # noqa: N802
            # A second way back to the portal for an employee who closed the
            # tab: this listener stays up until enrollment completes, so
            # http://127.0.0.1:6119/ always leads somewhere useful.
            self.send_response(302)
            self.send_header("Location", enroll_url)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self):  # noqa: N802
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, OSError):
                self._json(400, {"error": "malformed request"})
                return

            # Compared as bytes: compare_digest rejects non-ASCII str outright,
            # and a hostile caller controls this field.
            if not hmac.compare_digest(
                    str(body.get("state") or "").encode("utf-8", "replace"),
                    state.encode()):
                log.warning("rejected an enrollment callback with a bad state")
                self._json(403, {"error": "state mismatch"})
                return

            token = str(body.get("token") or "").strip()
            admin_url = str(body.get("admin_url") or "").strip() or DEFAULT_ADMIN_URL
            if not token:
                self._json(400, {"error": "no token"})
                return

            try:
                result["config"] = enroll(token, admin_url)
            except Exception as exc:  # noqa: BLE001 - report it to the page
                log.error("first-run enrollment failed: %s", exc)
                self._json(502, {"error": str(exc)})
                return

            self._json(200, {"status": "enrolled",
                             "device_id": result["config"]["device_id"]})
            done.set()

    return Handler


def browser_enroll() -> Optional[dict]:
    """Opens the employee portal and blocks until it enrolls this device.

    Blocks rather than exiting so KeepAlive doesn't respawn the agent — and
    with it a fresh browser tab — every few seconds while the employee is
    still logging in. The browser is nudged again on a slow interval for the
    case where the tab was closed and nobody visited the loopback URL.
    """
    from http.server import ThreadingHTTPServer  # noqa: PLC0415

    portal_url = (os.environ.get(ENROLL_PORTAL_ENV) or DEFAULT_PORTAL_URL).rstrip("/")
    admin_url = (os.environ.get(ENROLL_ADMIN_ENV) or DEFAULT_ADMIN_URL).rstrip("/")
    parsed = urllib.parse.urlsplit(portal_url)
    portal_origin = f"{parsed.scheme}://{parsed.netloc}"

    state = uuid.uuid4().hex + uuid.uuid4().hex
    callback = f"http://127.0.0.1:{ENROLL_CALLBACK_PORT}/enroll"
    enroll_url = portal_url + "/enroll?" + urllib.parse.urlencode(
        {"state": state, "callback": callback})

    result: dict = {}
    done = threading.Event()
    handler = _enroll_callback_handler(state, portal_origin, result, done, enroll_url)

    try:
        server = ThreadingHTTPServer(("127.0.0.1", ENROLL_CALLBACK_PORT), handler)
    except OSError as exc:
        # Almost always a second copy of the agent already waiting on this
        # port. Enrolling twice would register two devices for one laptop.
        log.error("enrollment listener could not bind 127.0.0.1:%d (%s) — "
                  "is another Aavishield agent already running?",
                  ENROLL_CALLBACK_PORT, exc)
        return None

    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("Not enrolled yet — opening the employee portal to finish setup")
    log.info("If no browser opens, visit: %s", enroll_url)

    # Open once up front, then re-open on the slow interval until enrolled.
    _open_in_browser(enroll_url)
    while not done.wait(timeout=ENROLL_BROWSER_REOPEN):
        log.info("Still waiting for portal enrollment — reopening %s", enroll_url)
        _open_in_browser(enroll_url)

    server.shutdown()
    server.server_close()
    _discard_enroll_drops()
    log.info("Enrolled from the portal as device %s", result["config"]["device_id"])
    return result["config"]


# ─── CA trust helper (runs as root) ───────────────────────────────────────────
#
# Installing a root CA needs privileges the agent deliberately does not have:
# it lives in the employee's login session so it can drive their proxy
# settings. The package therefore also installs this as a system daemon, whose
# only job is to notice that a device has enrolled, fetch that org's CA with
# the credentials enrollment produced, put it in the system trust store, and
# leave MITM_TRUST_MARKER behind.
#
# Split out this way because the two halves become able to do their jobs at
# different times: at postinstall there are no credentials yet (nobody has
# enrolled), and after enrollment there are no privileges. Polling bridges the
# gap without the two processes needing to talk to each other.


def _console_user_configs() -> List[str]:
    """Every plausible per-user agent config on this machine.

    The daemon is systemwide but the config it needs belongs to whichever
    human is logged in, so it looks rather than assumes — a shared Mac may
    have several, and any of them being enrolled is enough to identify the org
    whose CA should be trusted."""
    found = []
    home_root = "/Users" if platform.system() == "Darwin" else "/home"
    try:
        names = os.listdir(home_root)
    except OSError:
        return found
    for name in names:
        path = os.path.join(home_root, name, ".aavishield", "config.json")
        if os.path.exists(path):
            found.append(path)
    return found


def _install_ca_darwin(pem_path: str) -> bool:
    result = subprocess.run(
        ["/usr/bin/security", "add-trusted-cert", "-d", "-r", "trustRoot",
         "-k", "/Library/Keychains/System.keychain", pem_path],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if result.returncode != 0:
        log.error("security add-trusted-cert failed: %s", result.stdout.strip())
        return False
    return True


def _install_ca_linux(pem_path: str) -> bool:
    target = "/usr/local/share/ca-certificates/aavishield-ca.crt"
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(pem_path) as src, open(target, "w") as dst:
            dst.write(src.read())
    except OSError as exc:
        log.error("could not stage the CA at %s: %s", target, exc)
        return False
    result = subprocess.run(["update-ca-certificates"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        log.error("update-ca-certificates failed: %s", (result.stderr or "").strip())
        return False
    return True


def _install_ca_windows(pem_path: str) -> bool:
    result = subprocess.run(["certutil", "-addstore", "-f", "Root", pem_path],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if result.returncode != 0:
        log.error("certutil -addstore failed: %s", result.stdout.strip())
        return False
    return True


def _trust_ca_once(config: dict) -> bool:
    """Fetches the org CA with this device's credentials and trusts it."""
    try:
        req = _agent_request(config, "/internal/agent/ca-cert")
        with _DIRECT_OPENER.open(req, timeout=MITM_CONFIG_FETCH_TIMEOUT) as resp:
            pem = resp.read()
    except (urllib.error.URLError, OSError) as exc:
        log.warning("could not download the org CA: %s", exc)
        return False

    if b"BEGIN CERTIFICATE" not in pem:
        log.error("the CA endpoint returned something that is not a certificate")
        return False

    marker_dir = os.path.dirname(MITM_TRUST_MARKER)
    try:
        os.makedirs(marker_dir, exist_ok=True)
    except OSError as exc:
        log.error("could not create %s: %s", marker_dir, exc)
        return False

    pem_path = os.path.join(marker_dir, "ca.pem")
    try:
        with open(pem_path, "wb") as f:
            f.write(pem)
    except OSError as exc:
        log.error("could not write %s: %s", pem_path, exc)
        return False

    system = platform.system()
    installer = {"Darwin": _install_ca_darwin,
                 "Windows": _install_ca_windows}.get(system, _install_ca_linux)
    if not installer(pem_path):
        return False

    # Written only after the trust store actually accepted the CA — the agent
    # treats this file as proof, so an optimistic marker would have it
    # decrypting HTTPS that browsers then refuse.
    try:
        with open(MITM_TRUST_MARKER, "w") as f:
            f.write(f"{MITM_CA_COMMON_NAME}\ninstalled={datetime.datetime.now().isoformat()}\n")
        os.chmod(MITM_TRUST_MARKER, 0o644)
    except OSError as exc:
        log.error("could not write the trust marker %s: %s", MITM_TRUST_MARKER, exc)
        return False

    log.info("Org CA installed in the system trust store — SSL Inspection can now run")
    return True


def ca_trust_daemon():
    """Entry point for `aavishield-agent --ca-trust-daemon` (root)."""
    log.info("CA trust helper starting")
    while True:
        if os.path.exists(MITM_TRUST_MARKER):
            log.info("CA already trusted — nothing to do")
            return 0

        for path in _console_user_configs():
            try:
                with open(path) as f:
                    config = json.load(f)
            except (OSError, ValueError):
                continue
            if not config.get("device_id") or not config.get("agent_key"):
                continue
            if _trust_ca_once(config):
                return 0

        time.sleep(CA_TRUST_POLL_INTERVAL)


# ─── Auto-update ──────────────────────────────────────────────────────────────

class AutoUpdater:
    """
    Polls the admin API for a newer packaged agent, verifies its SHA-256, and
    swaps the binary in place. Only runs for frozen (PyInstaller) builds —
    a source checkout is left alone so developers don't get their tree
    overwritten.
    """

    def __init__(self, config: dict):
        self.config = config

    @staticmethod
    def is_frozen() -> bool:
        return bool(getattr(sys, "frozen", False))

    def loop(self):
        while True:
            time.sleep(UPDATE_CHECK_INTERVAL)
            try:
                self.check_once()
            except Exception as exc:  # noqa: BLE001
                log.debug("update check failed: %s", exc)

    def check_once(self) -> bool:
        if not self.is_frozen():
            return False

        req = _agent_request(self.config, "/internal/agent/version")
        with _DIRECT_OPENER.open(req, timeout=RULES_FETCH_TIMEOUT) as resp:
            if resp.status == 204:  # no packages published yet
                return False
            manifest = json.load(resp)

        latest = str(manifest.get("version") or "")
        if not latest or not _version_gt(latest, AGENT_VERSION):
            return False

        platform_key = {"Darwin": "macos", "Windows": "windows"}.get(platform.system(), "linux")
        artifact = (manifest.get("artifacts") or {}).get(platform_key)
        if not artifact or not artifact.get("url") or not artifact.get("sha256"):
            log.info("update %s available but no artifact for %s", latest, platform_key)
            return False

        log.info("updating agent %s -> %s", AGENT_VERSION, latest)
        return self._download_and_swap(artifact["url"], artifact["sha256"])

    def _download_and_swap(self, url: str, expected_sha: str) -> bool:
        import hashlib  # noqa: PLC0415 - only needed on the update path
        import tempfile  # noqa: PLC0415

        target = sys.executable
        req = urllib.request.Request(url, headers={"User-Agent": f"AavishieldAgent/{AGENT_VERSION}"})
        digest = hashlib.sha256()

        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target) or ".", prefix=".aavishield-update-")
        try:
            with _DIRECT_OPENER.open(req, timeout=UPDATE_DOWNLOAD_TIMEOUT) as resp, os.fdopen(fd, "wb") as out:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    digest.update(chunk)
                    out.write(chunk)

            actual = digest.hexdigest()
            if actual.lower() != expected_sha.lower():
                # A mismatch means the download was corrupted or tampered with.
                # Never execute it.
                log.error("update rejected: sha256 %s != expected %s", actual, expected_sha)
                os.unlink(tmp)
                return False

            os.chmod(tmp, 0o755)
            os.replace(tmp, target)
        except Exception:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

        log.info("update staged — restarting to apply")
        # launchd / systemd / Task Scheduler restart us with KeepAlive.
        os._exit(0)


def _version_gt(a: str, b: str) -> bool:
    def parts(v: str) -> List[int]:
        out = []
        for chunk in v.split("."):
            digits = "".join(c for c in chunk if c.isdigit())
            out.append(int(digits) if digits else 0)
        return out

    pa, pb = parts(a), parts(b)
    pad = max(len(pa), len(pb))
    pa += [0] * (pad - len(pa))
    pb += [0] * (pad - len(pb))
    return pa > pb


# ─── Tray / menu-bar UI ───────────────────────────────────────────────────────

class TrayUI:
    """
    Optional status icon. pystray/Pillow are not always present (headless
    installs, minimal images), so a missing dependency degrades to running
    without a tray rather than failing to start.
    """

    def __init__(self, config: dict, cache: "PolicyCache"):
        self.config = config
        self.cache = cache
        self._icon = None
        self._render = None

    def start(self) -> bool:
        """Builds the status icon and reports whether one is available.

        This only *prepares* the icon — run_blocking() displays it, and must be
        called from the main thread. See run_blocking() for why.
        """
        try:
            import pystray  # noqa: PLC0415
            from PIL import Image, ImageDraw  # noqa: PLC0415
        except ImportError:
            log.info("tray UI unavailable (pystray/Pillow not installed) — running headless")
            return False

        try:
            def render(mode: str):
                img = Image.new("RGB", (64, 64), (10, 10, 10))
                d = ImageDraw.Draw(img)
                colour = {
                    "full":          (34, 197, 94),    # green — monitoring
                    "security_only": (250, 204, 21),   # amber — protection only
                    "paused":        (113, 113, 122),  # grey — off
                }.get(mode, (34, 197, 94))
                d.ellipse((12, 12, 52, 52), fill=colour)
                return img

            self._render = render
            image = render(GATE.mode)

            menu = pystray.Menu(
                pystray.MenuItem(lambda _: f"Aavishield {AGENT_VERSION}", None, enabled=False),
                pystray.MenuItem(lambda _: self._status_text(), None, enabled=False),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Open activity", self._open_portal),
                pystray.MenuItem("Check for updates now", self._check_updates),
            )
            self._icon = pystray.Icon("aavishield", image, "Aavishield", menu)
            threading.Thread(target=self._follow_mode, daemon=True).start()
            log.info("tray UI ready")
            return True
        except Exception as exc:  # noqa: BLE001 - a tray failure must never stop enforcement
            log.warning("tray UI failed to start: %s", exc)
            return False

    def run_blocking(self):
        """Runs the tray event loop until the icon is dismissed.

        MUST be called on the main thread. pystray's macOS backend initialises
        AppKit, and AppKit aborts the entire process with SIGTRAP
        ("NSUpdateCycleInitialize() is called off the main thread") when it is
        first touched from a secondary thread — which under launchd's KeepAlive
        turns into a permanent crash-restart loop with the system proxy left
        pointing at a dead port.
        """
        if self._icon is None:
            return
        try:
            self._icon.run()
        except Exception as exc:  # noqa: BLE001 - cosmetic only; enforcement continues
            log.warning("tray UI stopped: %s", exc)

    def _status_text(self) -> str:
        """What the person on this laptop sees.

        On a personal device this is not a nicety. Someone who has agreed to be
        monitored during working hours is entitled to see, at a glance, that it
        has actually stopped outside them — otherwise the schedule is a promise
        they have to take on faith.
        """
        mode = GATE.mode
        if mode == "paused":
            return f"Paused — personal time. {GATE.reason}".strip()
        if mode == "security_only":
            return f"Malware protection only — not monitoring. {GATE.reason}".strip()
        if not system_proxy_active():
            return "Proxy off — re-arming"
        reason = GATE.reason or ""
        return f"Monitoring active. {reason}".strip() if reason else "Monitoring active"

    def _follow_mode(self):
        """Repaints the icon when working hours start or end."""
        last = GATE.mode
        while True:
            time.sleep(10)
            mode = GATE.mode
            if mode == last or self._icon is None:
                continue
            last = mode
            try:
                self._icon.icon = self._render(mode)
                self._icon.update_menu()
            except Exception as exc:  # noqa: BLE001 - cosmetic only
                log.debug("could not repaint the tray icon: %s", exc)

    def _open_portal(self, *_):
        import webbrowser  # noqa: PLC0415
        webbrowser.open(self.config.get("portal_url") or self.config["admin_url"])

    def _check_updates(self, *_):
        try:
            AutoUpdater(self.config).check_once()
        except Exception as exc:  # noqa: BLE001
            log.warning("manual update check failed: %s", exc)


def main():
    # The privileged CA-trust helper shares this binary so the package ships
    # one signed, notarized executable instead of two.
    if "--ca-trust-daemon" in sys.argv[1:]:
        sys.exit(ca_trust_daemon())

    config = ensure_enrolled()
    if config is None:
        # No config and nobody dropped a token: this is a plain package
        # install, so ask the employee through the portal instead of dying
        # with an error only an administrator would know what to do with.
        config = browser_enroll()
    if config is None:
        print(f"Config not found at {CONFIG_PATH}")
        print(
            "Provide an enrollment token via the "
            f"{ENROLL_TOKEN_ENV} environment variable, an enroll.json drop, "
            "or run the installer from the employee portal."
        )
        sys.exit(1)

    raise_fd_limit()
    try:
        threading.stack_size(THREAD_STACK_BYTES)
    except (ValueError, RuntimeError) as exc:
        log.warning("Could not set thread stack size: %s", exc)

    log.info("Aavishield agent %s starting", AGENT_VERSION)
    log.info("Device: %s  Org: %s  Admin: %s", config["device_id"], config["org_id"], config["admin_url"])

    cache = PolicyCache(config)
    cache.refresh()  # best-effort synchronous load so day-one browsing is enforced immediately
    threats = ThreatIntelCache(config)
    casb = CASBControlCache(config)
    reporter = ActivityReporter(config)

    mitm = MITMEngine(config)
    mitm.refresh()  # best-effort synchronous load, same reasoning as cache.refresh() above

    def _shutdown(sig, frame):
        log.info("Shutting down Aavishield agent…")
        report_offline(config)
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    # Ask the server where we stand before touching the network. Without this
    # a personal laptop rebooted at 9pm would arm the proxy on startup and only
    # stand down at the first heartbeat a minute later — a minute of somebody's
    # private browsing going through us.
    seed_enforcement(config)
    if GATE.intercepts():
        # The agent owns its own interception now, so a packaged install works
        # without the shell installer having configured anything.
        apply_system_proxy()
    else:
        log.info("Starting outside working hours — not arming the proxy (%s)", GATE.reason)
        if system_proxy_active():
            clear_system_proxy()

    threading.Thread(target=heartbeat_loop, args=(config,), daemon=True).start()
    threading.Thread(target=cache.loop_refresh, daemon=True).start()
    threading.Thread(target=reporter.loop_flush, daemon=True).start()
    threading.Thread(target=mitm.loop_refresh, daemon=True).start()
    threading.Thread(target=ProxyWatchdog(config, reporter).loop, daemon=True).start()
    threading.Thread(target=AutoUpdater(config).loop, daemon=True).start()
    threading.Thread(target=AppControlWatcher(config).loop, daemon=True).start()

    # Time-and-activity monitoring: an input counter and the screenshot loop.
    # Both stay dormant until the org enables screenshots and enforcement is
    # full, so they cost nothing on a device that isn't being monitored.
    activity_monitor = ActivityMonitor()
    activity_monitor.start()
    threading.Thread(target=ScreenshotCapturer(config, activity_monitor).loop, daemon=True).start()

    # The tray owns the main thread (AppKit's requirement on macOS), so the
    # proxy — which used to block here — moves to a thread of its own. It stays
    # a daemon so a SIGTERM shutdown isn't held up by in-flight connections;
    # the join() below is what keeps the process alive.
    def _serve_or_exit():
        """Runs the proxy, and takes the process down with it if it stops.

        The proxy is the whole point of the agent. When it dies — a port clash
        with a stale instance, an unrecoverable accept error — the process must
        exit so KeepAlive restarts it. Merely losing the thread would leave a
        live tray and a healthy-looking job whose listener is gone, while the
        system proxy still points at 127.0.0.1:LOCAL_PORT — black-holing every
        app's traffic with no visible cause. os._exit because sys.exit in a
        non-main thread only unwinds that thread.
        """
        try:
            run_proxy(cache, reporter, threats, casb, mitm)
        except Exception:
            log.exception("Proxy stopped — exiting so the service manager restarts us")
        else:
            log.error("Proxy loop returned unexpectedly — exiting for a restart")
        os._exit(1)

    tray = TrayUI(config, cache)
    tray_ready = tray.start()

    proxy_thread = threading.Thread(target=_serve_or_exit, daemon=True)
    proxy_thread.start()

    if tray_ready:
        tray.run_blocking()

    # Reached when there is no tray, or the icon was dismissed. Enforcement is
    # the agent's actual job, so outliving the tray is the correct behaviour.
    proxy_thread.join()


if __name__ == "__main__":
    main()
