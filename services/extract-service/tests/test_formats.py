"""One test per format family, each asserting the canary value (card /
Aadhaar / PAN) embedded in the corpus fixture survives extraction and shows
up in a Segment's text — this is the thing that actually matters: can the
detector engine downstream ever see it."""

from __future__ import annotations

import json

import corpus
from conftest import all_text, image_items, run_extract, unscannable_reasons


def test_plain_text():
    items, _ = run_extract(corpus.CANARY_TEXT.encode(), "note.txt", "text/plain")
    assert corpus.CARD in all_text(items)
    assert corpus.AADHAAR in all_text(items)
    assert corpus.PAN in all_text(items)


def test_csv():
    csv_body = f"name,card,pan\nAlice,{corpus.CARD},{corpus.PAN}\n".encode()
    items, _ = run_extract(csv_body, "records.csv", "text/csv")
    assert corpus.CARD in all_text(items)
    assert corpus.PAN in all_text(items)


def test_json_chat_message_shaped():
    """This is the "Slack/Teams message body" case: a JSON payload whose
    string values contain the sensitive content, escaped the way a real
    chat client would send it."""
    body = json.dumps({"channel": "C123", "text": f"here is my card {corpus.CARD} ok?"}).encode()
    items, _ = run_extract(body, "", "application/json")
    assert corpus.CARD in all_text(items)


def test_ndjson_multiple_lines():
    body = ("\n".join(json.dumps({"msg": corpus.CANARY_TEXT}) for _ in range(3))).encode()
    items, _ = run_extract(body, "log.ndjson", "application/x-ndjson")
    assert corpus.CARD in all_text(items)


def test_urlencoded_form_body():
    body = f"username=bob&notes=card+is+{corpus.CARD}".encode()
    items, _ = run_extract(body, "", "application/x-www-form-urlencoded")
    assert corpus.CARD in all_text(items)


def test_html_strips_tags_but_keeps_text():
    body = f"<html><body><p>Card: {corpus.CARD}</p></body></html>".encode()
    items, _ = run_extract(body, "page.html", "text/html")
    assert corpus.CARD in all_text(items)


def test_xml_walks_text_and_attributes():
    body = f'<record ssn="{corpus.PAN}"><note>{corpus.CARD}</note></record>'.encode()
    items, _ = run_extract(body, "data.xml", "application/xml")
    text = all_text(items)
    assert corpus.CARD in text
    assert corpus.PAN in text


def test_docx():
    body = corpus.make_docx(f"Confidential: {corpus.CARD} / {corpus.PAN}")
    items, _ = run_extract(body, "report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    assert corpus.CARD in all_text(items)
    assert corpus.PAN in all_text(items)


def test_xlsx_shared_strings():
    body = corpus.make_xlsx(["header", corpus.CARD, corpus.PAN, "footer"])
    items, _ = run_extract(body, "salary.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    text = all_text(items)
    assert corpus.CARD in text
    assert corpus.PAN in text
    # Confirms the wrong-filename bug is fixed at the segment level: the
    # sheet segment carries the real xlsx filename, not some URL path guess.
    assert any(getattr(s, "filename", "") == "salary.xlsx" for s in items if hasattr(s, "filename"))


def test_pptx():
    body = corpus.make_pptx(["Q3 numbers", f"Card on file: {corpus.CARD}"])
    items, _ = run_extract(body, "deck.pptx", "")
    assert corpus.CARD in all_text(items)


def test_pdf_text_layer():
    # Long enough to clear the OCR sparse-text threshold (real documents
    # always are) — a page this short would legitimately look like a
    # scanned page with a tiny caption and correctly trigger OCR too.
    body = corpus.make_text_pdf(
        "This quarterly expense report contains reimbursement details. "
        f"Card on file: {corpus.CARD}. Please process by month end."
    )
    items, _ = run_extract(body, "doc.pdf", "application/pdf")
    assert corpus.CARD in all_text(items)
    sources = {getattr(i, "source", None) for i in items}
    assert "pdf" in sources
    assert "ocr" not in sources  # real text layer present, OCR must be skipped


def test_pdf_scanned_page_uses_ocr():
    """The core "PDF ki images ko OCR karo" requirement: a PDF page with NO
    text layer, only a rasterised image, must still yield the card number —
    via OCR, not text extraction."""
    png = corpus.make_document_photo_png([f"CARD {corpus.CARD}", f"PAN {corpus.PAN}"])
    pdf_bytes = corpus.make_scanned_pdf(png, width=1200, height=400)
    items, ctx = run_extract(pdf_bytes, "scan.pdf", "application/pdf")
    text = all_text(items)
    assert corpus.CARD in text
    assert ctx.ocr_pages == 1
    sources = {getattr(i, "source", None) for i in items}
    assert "ocr" in sources


def test_standalone_image_ocr():
    png = corpus.make_document_photo_png([f"AADHAAR {corpus.AADHAAR}"])
    items, _ = run_extract(png, "id_card.png", "image/png")
    assert corpus.AADHAAR in all_text(items)
    imgs = image_items(items)
    assert len(imgs) == 1
    assert imgs[0].w > 0 and imgs[0].h > 0
    assert imgs[0].b64  # a downscaled JPEG is available for vision-AI use


def test_zip_with_docx_inside():
    docx = corpus.make_docx(f"buried card {corpus.CARD}")
    zip_bytes = corpus.make_zip({"hr/salary_report.docx": docx})
    items, _ = run_extract(zip_bytes, "q3.zip", "application/zip")
    text = all_text(items)
    assert corpus.CARD in text
    parts = [getattr(i, "part", "") for i in items]
    assert any("q3.zip" in p and "salary_report.docx" in p for p in parts)


def test_doubly_nested_zip():
    inner = corpus.CANARY_TEXT.encode()
    nested = corpus.make_nested_zip(depth=2, innermost=inner)
    items, _ = run_extract(nested, "nested.zip", "application/zip")
    assert corpus.CARD in all_text(items)


def test_encrypted_zip_entry_is_unscannable():
    zip_bytes = corpus.make_zip({"secret.txt": b"hidden"}, encrypt=True)
    items, _ = run_extract(zip_bytes, "vault.zip", "application/zip")
    assert "encrypted_archive" in unscannable_reasons(items)


def test_tar_archive():
    tar_bytes = corpus.make_tar({"note.txt": corpus.CANARY_TEXT.encode()})
    items, _ = run_extract(tar_bytes, "backup.tar", "application/x-tar")
    assert corpus.CARD in all_text(items)


def test_gzip_single_file():
    gz_bytes = corpus.make_gzip(corpus.CANARY_TEXT.encode(), name="note.txt")
    items, _ = run_extract(gz_bytes, "note.txt.gz", "application/gzip")
    assert corpus.CARD in all_text(items)


def test_seven_zip_archive():
    import py7zr
    import io as _io
    buf = _io.BytesIO()
    with py7zr.SevenZipFile(buf, "w") as z:
        z.writestr(corpus.CANARY_TEXT.encode(), "note.txt")
    items, _ = run_extract(buf.getvalue(), "archive.7z", "application/x-7z-compressed")
    assert corpus.CARD in all_text(items)


def test_rar_is_unscannable_not_crash():
    fake_rar = b"Rar!\x1a\x07\x00" + b"\x00" * 64
    items, _ = run_extract(fake_rar, "archive.rar", "application/x-rar-compressed")
    assert "unsupported_archive" in unscannable_reasons(items)


def test_eml_with_body_and_attachment():
    docx = corpus.make_docx(f"attached card {corpus.CARD}")
    eml_bytes = corpus.make_eml(f"see attached, PAN is {corpus.PAN}",
                                 attachment_name="report.docx", attachment_bytes=docx)
    items, _ = run_extract(eml_bytes, "mail.eml", "message/rfc822")
    text = all_text(items)
    assert corpus.PAN in text     # from the body
    assert corpus.CARD in text    # from the recursively-scanned attachment


def test_multipart_form_data_uses_real_filename():
    ct, body = corpus.make_multipart(
        fields={"comment": f"note: {corpus.PAN}"},
        files={"upload": ("payslip_march.txt", corpus.CANARY_TEXT.encode())},
    )
    items, _ = run_extract(body, "upload", ct)
    text = all_text(items)
    assert corpus.CARD in text
    assert corpus.PAN in text
    filenames = {getattr(i, "filename", "") for i in items}
    # This is the fix for the "wrong filename" bug: the real inner filename
    # must appear, not the outer request's generic field/path name.
    assert "payslip_march.txt" in filenames


def test_legacy_doc_text_run_extraction():
    body = corpus.make_legacy_doc(f"Employee card on file: {corpus.CARD}")
    items, _ = run_extract(body, "old_report.doc", "application/msword")
    assert corpus.CARD in all_text(items)


def test_rtf():
    from striprtf.striprtf import rtf_to_text  # sanity: library present
    rtf_body = ("{\\rtf1\\ansi Card: " + corpus.CARD + "}").encode()
    items, _ = run_extract(rtf_body, "note.rtf", "application/rtf")
    assert corpus.CARD in all_text(items)
