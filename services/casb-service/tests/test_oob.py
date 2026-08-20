from app import oob, providers


def rec(**kw):
    return oob.FileRecord(**kw)


def test_public_sensitive_is_high():
    f = oob.analyze_file(rec(name="Q3 Salary Sheet.xlsx", share_type="public"))
    assert f and f.severity == "high"


def test_public_nonsensitive_is_medium():
    f = oob.analyze_file(rec(name="team-lunch-photo.jpg", share_type="public"))
    assert f and f.severity == "medium"


def test_external_sensitive_is_high():
    f = oob.analyze_file(rec(name="Customer Contract NDA.pdf", share_type="external",
                             external_domains=["competitor.com"]))
    assert f and f.severity == "high"
    assert "competitor.com" in f.issue


def test_external_nonsensitive_is_medium():
    f = oob.analyze_file(rec(name="marketing-brief.docx", share_type="external"))
    assert f and f.severity == "medium"


def test_internal_sensitive_is_low():
    f = oob.analyze_file(rec(name="payroll-2026.csv", share_type="internal"))
    assert f and f.severity == "low"


def test_private_clean_no_finding():
    assert oob.analyze_file(rec(name="notes.txt", share_type="private")) is None


def test_report_sorts_and_counts():
    files = [
        rec(name="lunch.jpg", share_type="public"),           # medium
        rec(name="passport-scan.pdf", share_type="public"),   # high
        rec(name="normal.txt", share_type="private"),         # none
        rec(name="ssn-list.xlsx", share_type="internal"),     # low
    ]
    report = oob.analyze(files)
    assert report.scanned == 4
    assert report.counts == {"high": 1, "medium": 1, "low": 1}
    assert report.findings[0].severity == "high"  # sorted most-severe first


def test_provider_manual_reads_inventory():
    inv = providers.fetch_inventory("manual", {"files": [{"name": "x.pdf", "share_type": "public"}]})
    assert len(inv) == 1 and inv[0].share_type == "public"


def test_provider_real_needs_oauth():
    import pytest
    with pytest.raises(providers.ProviderError):
        providers.fetch_inventory("google_workspace", {})
