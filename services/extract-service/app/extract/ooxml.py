"""DOCX / XLSX / PPTX — read directly as what they are (a zip of XML parts)
rather than through a full document-model library. This is what makes
"file size doesn't matter" true for a 300MB spreadsheet: only the parts
that actually hold text stream through the detector windowing, never the
whole workbook materialised as objects.

Falls back to `unscannable(encrypted_document)` for password-protected
Office files — detected by the presence of the OLE-wrapped
EncryptionInfo/EncryptedPackage streams msoffcrypto-tool looks for, which
show up as a *non-OOXML* zip (an encrypted .docx is actually a CFB/OLE
container, not a zip at all — see legacy_office.py, which is where these
land after sniffing).
"""

from __future__ import annotations

import zipfile
from typing import Iterable

from defusedxml import ElementTree as SafeET

from .base import ExtractContext, Item, Segment, Unscannable
from .images import bytes_to_image_segment

_NS_STRIP = True  # collapse "{uri}tag" -> "tag" for simpler matching below


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _all_text(xml_bytes: bytes, text_tags: set[str]) -> list[str]:
    out = []
    try:
        root = SafeET.fromstring(xml_bytes)
    except Exception:
        return out
    for elem in root.iter():
        if _local(elem.tag) in text_tags and elem.text:
            out.append(elem.text)
    return out


def extract(stream, part: str, filename: str, mime: str, ctx: ExtractContext, kind: str) -> Iterable[Item]:
    try:
        zf = zipfile.ZipFile(stream)
    except zipfile.BadZipFile:
        yield Unscannable(part=part, reason="corrupt", detail="not a valid OOXML container")
        return

    try:
        if kind == "docx":
            yield from _docx(zf, part, filename, ctx)
        elif kind == "xlsx":
            yield from _xlsx(zf, part, filename, ctx)
        elif kind == "pptx":
            yield from _pptx(zf, part, filename, ctx)
        yield from _media_images(zf, part, ctx)
    finally:
        zf.close()


def _docx(zf: zipfile.ZipFile, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    parts = [n for n in zf.namelist()
             if n.startswith(("word/document", "word/header", "word/footer", "word/footnotes", "word/endnotes"))
             and n.endswith(".xml")]
    texts = []
    for name in parts:
        data = zf.read(name)
        ctx.check_budget(len(data))
        texts.extend(_all_text(data, {"t"}))
    yield Segment(part=part, filename=filename, mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  source="docx", text="\n".join(texts))


def _xlsx(zf: zipfile.ZipFile, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    shared: list[str] = []
    if "xl/sharedStrings.xml" in zf.namelist():
        data = zf.read("xl/sharedStrings.xml")
        ctx.check_budget(len(data))
        shared = _all_text(data, {"t"})

    sheet_names = sorted(n for n in zf.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
    for sheet in sheet_names:
        data = zf.read(sheet)
        ctx.check_budget(len(data))
        cells = _xlsx_sheet_cells(data, shared)
        sheet_label = sheet.rsplit("/", 1)[-1].replace(".xml", "")
        yield Segment(part=f"{part}!{sheet_label}", filename=filename,
                      mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      source="xlsx", text="\n".join(cells))


def _xlsx_sheet_cells(xml_bytes: bytes, shared: list[str]) -> list[str]:
    out = []
    try:
        root = SafeET.fromstring(xml_bytes)
    except Exception:
        return out
    for c in root.iter():
        if _local(c.tag) != "c":
            continue
        t_attr = c.attrib.get("t")
        v_elem = None
        is_elem = None
        for child in c:
            lt = _local(child.tag)
            if lt == "v":
                v_elem = child
            elif lt == "is":
                is_elem = child
        if t_attr == "s" and v_elem is not None and v_elem.text is not None:
            try:
                idx = int(v_elem.text)
                if 0 <= idx < len(shared):
                    out.append(shared[idx])
            except ValueError:
                pass
        elif t_attr == "inlineStr" and is_elem is not None:
            for t in is_elem.iter():
                if _local(t.tag) == "t" and t.text:
                    out.append(t.text)
        elif v_elem is not None and v_elem.text is not None:
            # Numeric / cached formula value — still worth scanning; a card
            # number typed into a cell is stored exactly like this.
            out.append(v_elem.text)
    return out


def _pptx(zf: zipfile.ZipFile, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    slides = sorted(n for n in zf.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml"))
    for slide in slides:
        data = zf.read(slide)
        ctx.check_budget(len(data))
        texts = _all_text(data, {"t"})
        slide_label = slide.rsplit("/", 1)[-1].replace(".xml", "")
        yield Segment(part=f"{part}!{slide_label}", filename=filename,
                      mime="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                      source="pptx", text="\n".join(texts))


_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp")


def _media_images(zf: zipfile.ZipFile, part: str, ctx: ExtractContext) -> Iterable[Item]:
    if not ctx.images_enabled:
        return
    media = [n for n in zf.namelist()
             if "/media/" in n and n.lower().endswith(_IMAGE_EXTS)]
    for name in media:
        if not ctx.images_budget_remaining():
            break
        data = zf.read(name)
        ctx.check_budget(len(data))
        seg = bytes_to_image_segment(data, f"{part}!{name}", ctx)
        if seg is not None:
            ctx.images_emitted += 1
            yield seg
