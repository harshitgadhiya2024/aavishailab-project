"""Hostile-input corpus: every case here must terminate within its bounds,
emit an `unscannable` record, and never exhaust memory / hang the process —
that's the actual safety property "no file-size limit" depends on.
"""

from __future__ import annotations

import time

import corpus
from conftest import make_ctx, run_extract, unscannable_reasons


def test_decompression_bomb_hits_expansion_ratio(tmp_path):
    # 50KB of zeros compresses to well under 1KB; a tiny max_expansion_ratio
    # makes this deterministic and fast without needing gigabyte fixtures.
    zip_bytes = corpus.make_zip_bomb_entry(uncompressed_size=50_000)
    ctx = make_ctx(max_expansion_ratio=10, max_total_bytes=1024 * 1024 * 1024, input_bytes=len(zip_bytes))
    items, _ = run_extract(zip_bytes, "bomb.zip", "application/zip", ctx)
    reasons = unscannable_reasons(items)
    assert "expansion_ratio_exceeded" in reasons


def test_total_bytes_ceiling_enforced():
    zip_bytes = corpus.make_zip_bomb_entry(uncompressed_size=200_000)
    ctx = make_ctx(max_total_bytes=1000, max_expansion_ratio=1_000_000, input_bytes=len(zip_bytes))
    items, _ = run_extract(zip_bytes, "bomb.zip", "application/zip", ctx)
    assert "total_bytes_exceeded" in unscannable_reasons(items)


def test_nesting_depth_limit():
    nested = corpus.make_nested_zip(depth=8, innermost=b"deep")
    ctx = make_ctx(max_depth=3)
    items, _ = run_extract(nested, "deep.zip", "application/zip", ctx)
    assert "too_deep" in unscannable_reasons(items)


def test_entry_count_limit():
    many = {f"file{i}.txt": b"x" for i in range(50)}
    zip_bytes = corpus.make_zip(many)
    ctx = make_ctx(max_entries=10)
    items, _ = run_extract(zip_bytes, "many.zip", "application/zip", ctx)
    assert "too_many_entries" in unscannable_reasons(items)


def test_xxe_entity_is_not_expanded():
    """defusedxml must refuse the external entity outright rather than
    resolving it — the extracted text must NOT contain /etc/passwd
    contents, and the extraction must not raise or hang."""
    body = corpus.make_xxe_docx()
    items, _ = run_extract(body, "evil.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    from conftest import all_text
    text = all_text(items)
    assert "root:" not in text  # /etc/passwd's first line, if it had leaked


def test_global_deadline_stops_extraction_without_hanging():
    many = {f"file{i}.txt": corpus.CANARY_TEXT.encode() for i in range(200)}
    zip_bytes = corpus.make_zip(many)
    ctx = make_ctx(deadline_at=time.monotonic() + 0.001)  # already effectively expired
    time.sleep(0.01)
    start = time.monotonic()
    items, _ = run_extract(zip_bytes, "many.zip", "application/zip", ctx)
    elapsed = time.monotonic() - start
    assert elapsed < 5.0  # must not hang despite 200 entries
    assert "extraction_timeout" in unscannable_reasons(items)


def test_corrupt_zip_does_not_crash():
    items, _ = run_extract(b"PK\x03\x04" + b"\x00" * 40, "broken.zip", "application/zip")
    assert unscannable_reasons(items)  # some unscannable reason, not an exception


def test_corrupt_pdf_does_not_crash():
    items, _ = run_extract(b"%PDF-1.4\nnot really a pdf", "broken.pdf", "application/pdf")
    assert unscannable_reasons(items)


def test_encrypted_office_document_via_ole_wrapper():
    """A password-protected .docx is not a zip at all — it's an OLE
    container wrapping EncryptionInfo/EncryptedPackage streams. Must be
    correctly identified as encrypted_document, not silently misread as
    legacy binary garbage."""
    body = corpus.make_ole_with_stream("EncryptionInfo", b"\x01\x02\x03")
    items, _ = run_extract(body, "protected.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    assert "encrypted_document" in unscannable_reasons(items)


def test_unrecognised_binary_is_unsupported_not_silently_dropped():
    items, _ = run_extract(b"\x01\x02\x03\x04\xff\xfe\x00garbage-binary", "mystery.bin", "application/octet-stream")
    assert "unsupported_format" in unscannable_reasons(items)
