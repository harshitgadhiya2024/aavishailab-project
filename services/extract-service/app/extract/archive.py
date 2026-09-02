"""ZIP / TAR / GZIP / 7z, with the resource bounds that make "no file-size
limit, but never fall over" actually safe: nesting depth, entry count,
decompressed-bytes total, and expansion ratio are all enforced through
ExtractContext.check_budget on every entry, not just at the top.

Entries are never written to disk by their own path — each one is read into
an in-memory BytesIO and handed to the generic dispatcher — so a zip-slip
entry name like "../../etc/passwd" is inert here: it only ever becomes a
display string in `part`, never a filesystem path.
"""

from __future__ import annotations

import gzip as gzip_mod
import io
import tarfile
import zipfile
from typing import Iterable

from .base import BudgetExceeded, ExtractContext, Item, Unscannable

try:
    import py7zr
except ImportError:  # pragma: no cover - optional at runtime, required by requirements.txt
    py7zr = None


def _recurse(payload: bytes, part: str, filename: str, mime: str, ctx: ExtractContext) -> Iterable[Item]:
    from . import engine  # local import: engine imports this module too
    child = ctx.child()
    try:
        yield from engine.dispatch(io.BytesIO(payload), part, filename, mime, child)
    finally:
        ctx.absorb(child)


def extract_zip(stream, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    try:
        zf = zipfile.ZipFile(stream)
    except zipfile.BadZipFile:
        yield Unscannable(part=part, reason="corrupt", detail="not a valid zip")
        return

    try:
        for info in zf.infolist():
            if info.is_dir():
                continue
            try:
                ctx.check_budget(info.file_size)
            except BudgetExceeded as e:
                yield Unscannable(part=f"{part}!{info.filename}", reason=e.reason, detail=e.detail)
                return

            entry_part = f"{part}!{info.filename}"
            if info.flag_bits & 0x1:  # encrypted entry
                yield Unscannable(part=entry_part, reason="encrypted_archive",
                                   detail="password-protected zip entry")
                continue
            try:
                payload = zf.read(info)
            except (RuntimeError, zipfile.BadZipFile, OSError) as exc:
                yield Unscannable(part=entry_part, reason="corrupt", detail=str(exc))
                continue

            yield from _recurse(payload, entry_part, info.filename, "", ctx)
    finally:
        zf.close()


def extract_gzip(stream, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    inner_name = filename[:-3] if filename.lower().endswith(".gz") else (filename or "content")
    try:
        with gzip_mod.GzipFile(fileobj=stream) as gz:
            chunks = []
            total = 0
            while True:
                chunk = gz.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                ctx.check_budget(len(chunk))
                chunks.append(chunk)
            payload = b"".join(chunks)
    except (OSError, EOFError) as exc:
        yield Unscannable(part=part, reason="corrupt", detail=str(exc))
        return
    except BudgetExceeded as e:
        yield Unscannable(part=part, reason=e.reason, detail=e.detail)
        return

    yield from _recurse(payload, f"{part}!{inner_name}", inner_name, "", ctx)


def extract_tar(stream, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    try:
        tf = tarfile.open(fileobj=stream, mode="r:*")
    except tarfile.TarError as exc:
        yield Unscannable(part=part, reason="corrupt", detail=str(exc))
        return

    try:
        for member in tf:
            if not member.isfile():
                continue
            try:
                ctx.check_budget(member.size)
            except BudgetExceeded as e:
                yield Unscannable(part=f"{part}!{member.name}", reason=e.reason, detail=e.detail)
                return

            entry_part = f"{part}!{member.name}"
            fh = tf.extractfile(member)  # in-memory file object, nothing touches disk
            if fh is None:
                continue
            payload = fh.read()
            yield from _recurse(payload, entry_part, member.name, "", ctx)
    finally:
        tf.close()


def extract_7z(stream, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    if py7zr is None:
        yield Unscannable(part=part, reason="unsupported_archive", detail="py7zr not installed")
        return
    try:
        archive = py7zr.SevenZipFile(stream, mode="r")
    except py7zr.exceptions.PasswordRequired:
        yield Unscannable(part=part, reason="encrypted_archive", detail="password-protected 7z")
        return
    except (py7zr.Bad7zFile, OSError) as exc:
        yield Unscannable(part=part, reason="corrupt", detail=str(exc))
        return

    try:
        names = archive.getnames()
        try:
            ctx.check_budget()
            for n in names:
                ctx.check_budget()
        except BudgetExceeded as e:
            yield Unscannable(part=part, reason=e.reason, detail=e.detail)
            return

        try:
            extracted = archive.readall()  # {name: BytesIO}
        except py7zr.exceptions.PasswordRequired:
            yield Unscannable(part=part, reason="encrypted_archive", detail="password-protected 7z")
            return

        for name, bio in (extracted or {}).items():
            payload = bio.read()
            try:
                ctx.check_budget(len(payload))
            except BudgetExceeded as e:
                yield Unscannable(part=f"{part}!{name}", reason=e.reason, detail=e.detail)
                return
            yield from _recurse(payload, f"{part}!{name}", name, "", ctx)
    finally:
        archive.close()
