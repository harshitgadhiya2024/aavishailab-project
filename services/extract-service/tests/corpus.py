"""Builds test fixture files in memory — no binary blobs checked into the
repo. Every builder produces the *actual* container format (a real zip for
docx/xlsx/pptx, a real OLE/CFB stream for legacy .doc, a real rasterised
PDF page for the OCR path) so tests exercise the real parsing libraries,
not a hand-waved substitute.

Canary values used throughout (must stay in sync with the detector
implementations in services/dlp-service*/):
  CARD      = 4111111111111111   (Luhn-valid Visa test number)
  AADHAAR   = 234123412346       (Verhoeff-valid)
  PAN       = ABCDE1234F         (format-valid; PAN has no checksum)
"""

from __future__ import annotations

import io
import struct
import tarfile
import zipfile

CARD = "4111111111111111"
AADHAAR = "234123412346"
PAN = "ABCDE1234F"
CANARY_TEXT = f"Card: {CARD}  Aadhaar: {AADHAAR}  PAN: {PAN}"


def make_zip(entries: dict[str, bytes], encrypt: bool = False, password: bytes = b"secret") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    raw = buf.getvalue()
    if encrypt:
        raw = _set_zip_encryption_flag(raw)
    return raw


def _set_zip_encryption_flag(raw: bytes) -> bytes:
    """Python's zipfile can only *read* ZipCrypto/AES-encrypted entries, not
    write them — there is no stdlib way to produce a genuinely
    password-protected zip. This instead flips the general-purpose bit flag
    (bit 0 = "entry is encrypted") directly in both the local file header
    and the central directory record, which is the exact bit
    extract_zip checks via ZipInfo.flag_bits & 0x1 — the same signal a
    real encrypted entry carries, without needing to implement a cipher."""
    data = bytearray(raw)
    idx = data.find(b"PK\x03\x04")
    if idx != -1:
        data[idx + 6] |= 0x1
    idx = data.find(b"PK\x01\x02")
    if idx != -1:
        data[idx + 8] |= 0x1
    return bytes(data)


def make_tar(entries: dict[str, bytes], gz: bool = False) -> bytes:
    buf = io.BytesIO()
    mode = "w:gz" if gz else "w"
    with tarfile.open(fileobj=buf, mode=mode) as tf:
        for name, data in entries.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def make_gzip(data: bytes, name: str = "content.txt") -> bytes:
    import gzip
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", filename=name) as gz:
        gz.write(data)
    return buf.getvalue()


# ─── OOXML (hand-built minimal, valid parts only) ──────────────────────────

_CONTENT_TYPES_DOCX = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""


def make_docx(paragraph_text: str) -> bytes:
    doc_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>{paragraph_text}</w:t></w:r></w:p></w:body>
</w:document>""".encode("utf-8")
    return make_zip({
        "[Content_Types].xml": _CONTENT_TYPES_DOCX,
        "word/document.xml": doc_xml,
    })


_CONTENT_TYPES_XLSX = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>"""


def make_xlsx(sheet1_cell_texts: list[str]) -> bytes:
    shared_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(sheet1_cell_texts)}" uniqueCount="{len(sheet1_cell_texts)}">'
        + "".join(f"<si><t>{t}</t></si>" for t in sheet1_cell_texts)
        + "</sst>"
    ).encode("utf-8")
    cells = "".join(
        f'<c r="A{i+1}" t="s"><v>{i}</v></c>' for i in range(len(sheet1_cell_texts))
    )
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData><row r="1">{cells}</row></sheetData></worksheet>'
    ).encode("utf-8")
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets>'
        '</workbook>'
    ).encode("utf-8")
    return make_zip({
        "[Content_Types].xml": _CONTENT_TYPES_XLSX,
        "xl/workbook.xml": workbook_xml,
        "xl/sharedStrings.xml": shared_xml,
        "xl/worksheets/sheet1.xml": sheet_xml,
    })


_CONTENT_TYPES_PPTX = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>"""


def make_pptx(slide_texts: list[str]) -> bytes:
    entries = {
        "[Content_Types].xml": _CONTENT_TYPES_PPTX,
        "ppt/presentation.xml": b"<p:presentation/>",
    }
    for i, text in enumerate(slide_texts, start=1):
        slide_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>""".encode("utf-8")
        entries[f"ppt/slides/slide{i}.xml"] = slide_xml
    return make_zip(entries)


# ─── PDF ────────────────────────────────────────────────────────────────────

def make_text_pdf(text: str) -> bytes:
    """A minimal single-page PDF with a real text-showing content stream —
    hand-built raw PDF syntax (no writer library) so this exercises
    pypdfium2's actual text-extraction path."""
    content = f"BT /F1 24 Tf 40 700 Td ({_pdf_escape(text)}) Tj ET".encode("latin-1")
    objects = []
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    objects.append(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    objects.append(
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
    )
    objects.append(b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")
    objects.append(
        b"5 0 obj\n<< /Length " + str(len(content)).encode() + b" >>\nstream\n"
        + content + b"\nendstream\nendobj\n"
    )

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(out.tell())
        out.write(obj)
    xref_offset = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode()
    )
    return out.getvalue()


def _pdf_escape(s: str) -> str:
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def make_scanned_pdf(image_png_bytes: bytes, width: int = 600, height: int = 200) -> bytes:
    """A single-page PDF whose only content is an embedded raster image —
    no text layer at all, i.e. exactly what a phone-camera scan produces.
    Built via pypdfium2's own page-construction API (a real PDF writer, not
    hand-crafted syntax) so the roundtrip through pypdfium2 on the read side
    is a faithful test."""
    import pypdfium2 as pdfium
    from PIL import Image

    pil_img = Image.open(io.BytesIO(image_png_bytes))
    pdf = pdfium.PdfDocument.new()
    page = pdf.new_page(width, height)
    img_obj = pdfium.PdfImage.new(pdf)
    img_obj.set_bitmap(pdfium.PdfBitmap.from_pil(pil_img))
    img_obj.set_matrix(pdfium.PdfMatrix().scale(width, height))
    page.insert_obj(img_obj)
    page.gen_content()
    buf = io.BytesIO()
    pdf.save(buf)
    pdf.close()
    return buf.getvalue()


# ─── Images ─────────────────────────────────────────────────────────────────

def make_document_photo_png(lines: list[str], size=(1200, 400)) -> bytes:
    """A synthetic 'photographed document' — large printed text on a plain
    background, which is what Tesseract needs to reliably OCR without a
    scanner-grade preprocessing pipeline."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
    except OSError:
        font = ImageFont.load_default()
    y = 30
    for line in lines:
        d.text((30, y), line, fill="black", font=font)
        y += 70
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ─── Legacy OLE (.doc-shaped) ───────────────────────────────────────────────
# olefile is read-only (no writer), so this hand-builds a minimal but
# spec-valid single-FAT-sector CFB (MS-CFB) container: one stream, no mini
# stream (kept simple by making the payload exceed the 4096-byte mini-stream
# cutoff so it always goes through the regular FAT chain). Enough to
# exercise legacy_office.py's real olefile-based read path end to end,
# without needing a real MS Word/Excel writer.

_FREESECT = 0xFFFFFFFF
_ENDOFCHAIN = 0xFFFFFFFE
_FATSECT = 0xFFFFFFFD
_SECTOR = 512


def _cfb_dir_entry(name: str, obj_type: int, color: int, left: int, right: int,
                    child: int, start_sector: int, size: int) -> bytes:
    name_utf16 = name.encode("utf-16-le") + b"\x00\x00"
    return (
        name_utf16.ljust(64, b"\x00")[:64]
        + struct.pack("<H", len(name_utf16))
        + struct.pack("<B", obj_type)
        + struct.pack("<B", color)
        + struct.pack("<I", left)
        + struct.pack("<I", right)
        + struct.pack("<I", child)
        + b"\x00" * 16   # CLSID
        + struct.pack("<I", 0)   # state bits
        + b"\x00" * 8    # creation time
        + b"\x00" * 8    # modified time
        + struct.pack("<I", start_sector)
        + struct.pack("<Q", size)
    )


def make_ole_with_stream(stream_name: str, stream_data: bytes) -> bytes:
    n_data_sectors = max(1, (len(stream_data) + _SECTOR - 1) // _SECTOR)
    fat_sector_index = n_data_sectors
    dir_sector_index = n_data_sectors + 1

    fat_entries = [_FREESECT] * 128
    for i in range(n_data_sectors - 1):
        fat_entries[i] = i + 1
    fat_entries[n_data_sectors - 1] = _ENDOFCHAIN
    fat_entries[fat_sector_index] = _FATSECT
    fat_entries[dir_sector_index] = _ENDOFCHAIN
    fat_sector = b"".join(struct.pack("<I", e) for e in fat_entries)

    root = _cfb_dir_entry("Root Entry", 5, 1, _FREESECT, _FREESECT, 1, _ENDOFCHAIN, 0)
    entry = _cfb_dir_entry(stream_name, 2, 1, _FREESECT, _FREESECT, _FREESECT, 0, len(stream_data))
    dir_sector = root + entry + b"\x00" * 128 + b"\x00" * 128

    header = bytearray(512)
    header[0:8] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    struct.pack_into("<H", header, 24, 0x003E)
    struct.pack_into("<H", header, 26, 0x0003)
    struct.pack_into("<H", header, 28, 0xFFFE)
    struct.pack_into("<H", header, 30, 9)
    struct.pack_into("<H", header, 32, 6)
    struct.pack_into("<I", header, 40, 0)
    struct.pack_into("<I", header, 44, 1)
    struct.pack_into("<I", header, 48, dir_sector_index)
    struct.pack_into("<I", header, 52, 0)
    struct.pack_into("<I", header, 56, 4096)
    struct.pack_into("<I", header, 60, _ENDOFCHAIN)
    struct.pack_into("<I", header, 64, 0)
    struct.pack_into("<I", header, 68, _ENDOFCHAIN)
    struct.pack_into("<I", header, 72, 0)
    difat = [_FREESECT] * 109
    difat[0] = fat_sector_index
    for i, v in enumerate(difat):
        struct.pack_into("<I", header, 76 + i * 4, v)

    data_padded = stream_data.ljust(n_data_sectors * _SECTOR, b"\x00")
    return bytes(header) + data_padded + fat_sector + dir_sector


def make_legacy_doc(text: str) -> bytes:
    """Pads the payload past the mini-stream cutoff (4096 bytes) so
    legacy_office.py's generic printable-run extraction has to find the
    canary text buried in an otherwise-binary-looking stream — the same
    shape a real .doc's WordDocument stream has."""
    padding = b"\x01\x02\x03\x04" * 1100  # ~4400 bytes of non-printable noise
    payload = padding + text.encode("ascii") + padding
    return make_ole_with_stream("WordDocument", payload)


# ─── Email ──────────────────────────────────────────────────────────────────

def make_eml(body_text: str, attachment_name: str | None = None, attachment_bytes: bytes | None = None) -> bytes:
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["Subject"] = "Test message"
    msg["From"] = "alice@example.com"
    msg["To"] = "bob@example.com"
    msg.set_content(body_text)
    if attachment_name and attachment_bytes is not None:
        msg.add_attachment(attachment_bytes, maintype="application", subtype="octet-stream",
                            filename=attachment_name)
    return msg.as_bytes()


# ─── multipart/form-data ────────────────────────────────────────────────────

def make_multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes]], boundary: str = "TESTBOUNDARY123"):
    """Returns (content_type, body_bytes)."""
    parts = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    for name, (filename, data) in files.items():
        parts.append(
            (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
             f'Content-Type: application/octet-stream\r\n\r\n').encode() + data + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    return f"multipart/form-data; boundary={boundary}", body


# ─── Zip bomb / security corpus ─────────────────────────────────────────────

def make_zip_bomb_entry(uncompressed_size: int) -> bytes:
    """A single highly-compressible entry (all zero bytes) that expands far
    beyond its compressed size — the classic decompression-bomb shape,
    scaled down to a size this test suite can build and check quickly."""
    return make_zip({"bomb.bin": b"\x00" * uncompressed_size})


def make_nested_zip(depth: int, innermost: bytes = b"hello") -> bytes:
    data = innermost
    for i in range(depth):
        data = make_zip({f"level{i}.bin": data})
    return data


XXE_DOCX_DOCUMENT_XML = b"""<?xml version="1.0"?>
<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body>
</w:document>"""


def make_xxe_docx() -> bytes:
    return make_zip({
        "[Content_Types].xml": _CONTENT_TYPES_DOCX,
        "word/document.xml": XXE_DOCX_DOCUMENT_XML,
    })
