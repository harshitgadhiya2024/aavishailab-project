"""RFC 822 email (.eml) — walks every part recursively, so an attachment
(itself a PDF, a DOCX, a nested email...) gets the exact same inspection an
upload of that same file would get. Uses the stdlib `email` package only.
"""

from __future__ import annotations

import io
from email import message_from_bytes, policy
from typing import Iterable

from .base import ExtractContext, Item, Segment


def extract(stream, part: str, filename: str, ctx: ExtractContext) -> Iterable[Item]:
    from . import engine  # local import: engine imports this module too

    raw = stream.read()
    ctx.check_budget(len(raw))
    msg = message_from_bytes(raw, policy=policy.default)

    headers = "\n".join(f"{k}: {v}" for k, v in msg.items())
    yield Segment(part=f"{part}!headers", filename=filename, mime="message/rfc822",
                  source="eml_headers", text=headers)

    seq = 0
    for sub in msg.walk():
        if sub.is_multipart():
            continue
        seq += 1
        payload = sub.get_payload(decode=True)
        if payload is None:
            continue
        ctx.check_budget(len(payload))

        sub_filename = sub.get_filename() or f"part{seq}"
        sub_mime = sub.get_content_type()
        sub_part = f"{part}!{sub_filename}"

        if sub.get_content_maintype() == "text" and not sub.get_filename():
            # An inline body part, not an attachment — decode as text
            # directly rather than routing through the generic dispatcher,
            # which would otherwise treat it as an unrecognised binary blob.
            charset = sub.get_content_charset() or "utf-8"
            try:
                text = payload.decode(charset, errors="replace")
            except (LookupError, UnicodeDecodeError):
                text = payload.decode("utf-8", errors="replace")
            yield Segment(part=sub_part, filename=filename, mime=sub_mime, source="eml_body", text=text)
            continue

        child = ctx.child()
        try:
            yield from engine.dispatch(io.BytesIO(payload), sub_part, sub_filename, sub_mime, child)
        finally:
            ctx.absorb(child)
