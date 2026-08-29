"""Content sniffing by magic bytes. The client's declared Content-Type is
never trusted for dispatch — a renamed .exe served as "image/png" is exactly
the kind of thing DLP/malware inspection exists to catch, and if dispatch
followed the label instead of the bytes it would just be scanning the wrong
parser (or none at all).
"""

from __future__ import annotations

import zipfile
from io import BytesIO
from typing import Optional

# (magic bytes, offset, family)
_SIGNATURES = [
    (b"PK\x03\x04", 0, "zip"),
    (b"PK\x05\x06", 0, "zip"),   # empty zip
    (b"\x1f\x8b", 0, "gzip"),
    (b"%PDF-", 0, "pdf"),
    (b"Rar!\x1a\x07", 0, "rar"),
    (b"7z\xbc\xaf\x27\x1c", 0, "7z"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", 0, "ole"),   # legacy .doc/.xls/.ppt/.msg
    (b"\x89PNG\r\n\x1a\n", 0, "png"),
    (b"\xff\xd8\xff", 0, "jpeg"),
    (b"GIF87a", 0, "gif"),
    (b"GIF89a", 0, "gif"),
    (b"BM", 0, "bmp"),
    (b"RIFF", 0, "riff"),         # webp lives inside a RIFF container
    (b"II*\x00", 0, "tiff"),
    (b"MM\x00*", 0, "tiff"),
    (b"{\\rtf1", 0, "rtf"),
    (b"From ", 0, "eml_mbox"),
]

_OOXML_CONTENT_TYPES = {
    "word/document.xml": "docx",
    "xl/workbook.xml": "xlsx",
    "ppt/presentation.xml": "pptx",
}

_EXT_FALLBACK = {
    ".txt": "text", ".log": "text", ".md": "text", ".ini": "text", ".conf": "text",
    ".yaml": "text", ".yml": "text", ".csv": "csv", ".tsv": "csv",
    ".json": "json", ".ndjson": "json", ".jsonl": "json",
    ".xml": "xml", ".html": "html", ".htm": "html",
    ".eml": "eml", ".msg": "ole",
    ".doc": "ole", ".xls": "ole", ".ppt": "ole",
    ".docx": "zip", ".xlsx": "zip", ".pptx": "zip",
    ".zip": "zip", ".tar": "tar", ".gz": "gzip", ".tgz": "gzip",
    ".rar": "rar", ".7z": "7z",
    ".rtf": "rtf",
    ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".gif": "gif", ".bmp": "bmp",
    ".webp": "webp", ".tif": "tiff", ".tiff": "tiff",
    ".pdf": "pdf",
}


def _extension(filename: str) -> str:
    filename = (filename or "").lower()
    if "." not in filename:
        return ""
    return "." + filename.rsplit(".", 1)[-1]


_CONTENT_TYPE_MAP = {
    "application/json": "json",
    "text/json": "json",
    "application/x-ndjson": "json",
    "application/x-www-form-urlencoded": "urlencoded",
    "text/csv": "csv",
    "text/tab-separated-values": "csv",
    "application/xml": "xml",
    "text/xml": "xml",
    "text/html": "html",
    "text/plain": "text",
    "message/rfc822": "eml",
}


def sniff_family(head: bytes, filename: str = "", content_type: str = "") -> str:
    """Returns a coarse family string ("zip", "pdf", "ole", "text", ...).
    Zip-family results are refined into docx/xlsx/pptx/zip by
    `sniff_zip_kind`, which needs the whole (seekable) file, not just the
    head bytes this function sees.

    Real magic bytes always win over the caller's declared content-type —
    that label is attacker-controlled and a renamed/mislabelled binary is
    exactly the case worth catching. content-type (and then extension) is
    only consulted for formats with no reliable magic at all (JSON, form-
    encoded, CSV, plain text) — the shapes chat-app and API payloads use.
    """
    for sig, offset, family in _SIGNATURES:
        if head[offset:offset + len(sig)] == sig:
            if family == "riff":
                return "webp" if head[8:12] == b"WEBP" else "riff"
            return family

    ct = (content_type or "").split(";", 1)[0].strip().lower()
    if ct in _CONTENT_TYPE_MAP:
        return _CONTENT_TYPE_MAP[ct]

    ext_family = _EXT_FALLBACK.get(_extension(filename))
    if ext_family:
        return ext_family

    stripped = head.lstrip()
    if stripped[:1] in (b"{", b"["):
        return "json"
    if stripped[:1] == b"<":
        return "xml"

    # No magic match, no useful hint: guess text vs binary by whether the
    # head decodes cleanly and contains no NUL bytes.
    if b"\x00" not in head:
        try:
            head.decode("utf-8")
            return "text"
        except UnicodeDecodeError:
            pass
    return "binary"


def sniff_zip_kind(fileobj) -> str:
    """Distinguishes a real OOXML document from a plain zip archive by
    reading its [Content_Types].xml part — far cheaper and more reliable
    than sniffing well-known internal filenames, which archive tools don't
    always preserve in the same order."""
    pos = fileobj.tell()
    try:
        with zipfile.ZipFile(fileobj) as zf:
            names = set(zf.namelist())
            for marker, kind in _OOXML_CONTENT_TYPES.items():
                if marker in names:
                    return kind
            return "zip"
    except zipfile.BadZipFile:
        return "zip"
    finally:
        fileobj.seek(pos)
