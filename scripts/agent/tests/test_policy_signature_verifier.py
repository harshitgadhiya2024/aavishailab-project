"""PolicySignatureVerifier.verify() — the integrity check standing between a
compromised transport and a device silently applying tampered policy. No
network: tests pin a key directly (bypassing ensure_key's fetch), exactly
like a completed first-fetch would leave it."""

import base64

import pytest
from conftest import agent
from cryptography.hazmat.primitives.asymmetric import ed25519


def make_verifier(key_id, public_key):
    v = agent.PolicySignatureVerifier(config={})
    v._key_id = key_id
    v._public_key = public_key
    return v


def sign(private_key, body: bytes) -> str:
    return base64.b64encode(private_key.sign(body)).decode()


@pytest.fixture
def keypair():
    private_key = ed25519.Ed25519PrivateKey.generate()
    return private_key, private_key.public_key()


def test_accepts_a_genuine_signature(keypair):
    private_key, public_key = keypair
    body = b'{"rules":[]}'
    v = make_verifier("kid-1", public_key)
    assert v.verify(body, sign(private_key, body), "kid-1") is True


def test_rejects_tampered_body(keypair):
    private_key, public_key = keypair
    signed_body = b'{"rules":[{"domain":"a.com","action":"allow"}]}'
    sig = sign(private_key, signed_body)
    v = make_verifier("kid-1", public_key)

    tampered = b'{"rules":[{"domain":"a.com","action":"block"}]}'
    assert v.verify(tampered, sig, "kid-1") is False


def test_rejects_key_id_mismatch(keypair):
    private_key, public_key = keypair
    body = b'{"rules":[]}'
    sig = sign(private_key, body)
    v = make_verifier("kid-1", public_key)

    # Genuinely valid under the pinned key, but claiming a different key_id —
    # must still reject, since this is what protects against a compromised
    # server later presenting a different key under a false key_id.
    assert v.verify(body, sig, "kid-DIFFERENT") is False


def test_rejects_missing_signature_header(keypair):
    _, public_key = keypair
    v = make_verifier("kid-1", public_key)
    assert v.verify(b"{}", None, "kid-1") is False


def test_rejects_missing_key_id_header(keypair):
    _, public_key = keypair
    v = make_verifier("kid-1", public_key)
    assert v.verify(b"{}", "some-sig", None) is False


def test_rejects_when_no_key_pinned_yet():
    v = agent.PolicySignatureVerifier(config={})
    assert v.verify(b"{}", "anything", "kid-1") is False


def test_rejects_malformed_base64_signature(keypair):
    _, public_key = keypair
    v = make_verifier("kid-1", public_key)
    assert v.verify(b"{}", "not-valid-base64!!!", "kid-1") is False


def test_rejects_wrong_length_signature(keypair):
    _, public_key = keypair
    v = make_verifier("kid-1", public_key)
    short_sig = base64.b64encode(b"too-short").decode()
    assert v.verify(b"{}", short_sig, "kid-1") is False


def test_parse_key_roundtrips_a_real_key(keypair):
    _, public_key = keypair
    raw = public_key.public_bytes_raw()
    pubkey_b64 = base64.b64encode(raw).decode()

    parsed = agent.PolicySignatureVerifier._parse_key("kid-42", pubkey_b64)
    assert parsed is not None
    key_id, parsed_key = parsed
    assert key_id == "kid-42"
    assert parsed_key.public_bytes_raw() == raw


def test_parse_key_rejects_empty_key_id():
    assert agent.PolicySignatureVerifier._parse_key("", "not-checked") is None


def test_parse_key_rejects_garbage_base64():
    assert agent.PolicySignatureVerifier._parse_key("kid-1", "!!!not-base64!!!") is None
