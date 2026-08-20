"""Unit tests for the detectors — the checksum/entropy gates that keep the
score honest."""

from app import detectors as d
from tests.conftest import valid_aadhaar

W = 50  # arbitrary weight for detector-only tests


def test_credit_card_requires_luhn():
    assert d.detect_credit_card("card 4242424242424242 here", W)  # valid Visa test PAN
    assert not d.detect_credit_card("card 4242424242424243 here", W)  # Luhn-invalid
    assert not d.detect_credit_card("id 1234567890123456", W)  # not Luhn-valid


def test_credit_card_with_separators():
    assert d.detect_credit_card("4242 4242 4242 4242", W)
    assert d.detect_credit_card("4242-4242-4242-4242", W)


def test_credit_card_preview_is_masked():
    m = d.detect_credit_card("4242424242424242", W)[0]
    assert m.preview.endswith("4242")
    assert m.preview.count("*") == 12


def test_aadhaar_verhoeff():
    good = valid_aadhaar()
    assert d.detect_aadhaar(f"aadhaar {good}", W)
    # Flip the check digit to an invalid one.
    bad = good[:-1] + str((int(good[-1]) + 1) % 10)
    if bad != good:
        assert not d.detect_aadhaar(f"aadhaar {bad}", W)


def test_aadhaar_only_one_checkdigit_validates():
    base = "23412341234"
    valid = [dig for dig in "0123456789" if d.verhoeff_valid(base + dig)]
    assert len(valid) == 1  # Verhoeff has exactly one valid check digit


def test_aws_key_entropy_gate():
    assert d.detect_aws_key("key AKIAIOSFODNN7EXAMPLE end", W)  # canonical AWS example
    assert not d.detect_aws_key("AKIAAAAAAAAAAAAAAAAA", W)  # zero-entropy -> rejected


def test_github_token():
    tok = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"
    assert d.detect_github_token(f"token {tok}", W)


def test_generic_api_key():
    assert d.detect_generic_api_key("api_key: 'aB3xZ9qL2mV8kP1n'", W)
    assert not d.detect_generic_api_key("password: 123", W)  # too short (<12)


def test_source_code_by_extension():
    assert d.detect_source_code("main.go", W)
    assert d.detect_source_code("app.py", W)
    assert not d.detect_source_code("report.pdf", W)


def test_keywords_case_insensitive():
    assert d.detect_keywords("This is CONFIDENTIAL", ["confidential"], W)
    assert not d.detect_keywords("nothing here", ["confidential"], W)


def test_custom_pattern_invalid_regex_skipped():
    patterns = [d.CustomPattern("bad", "([unclosed"), d.CustomPattern("proj", "PROJ-[0-9]+")]
    matches = d.detect_custom_patterns("ticket PROJ-1234", patterns, W)
    assert len(matches) == 1
    assert matches[0].label == "Custom: proj"


def test_file_category():
    assert d.file_category("a.png", "") == "image"
    assert d.file_category("", "image/jpeg") == "image"
    assert d.file_category("x.pdf", "") == "pdf"
    assert d.file_category("x.zip", "") == "archive"
    assert d.file_category("notes.txt", "text/plain") == "document"
