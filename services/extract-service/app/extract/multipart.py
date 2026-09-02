"""multipart/form-data — the format real browser file-upload forms (and
Gmail/Slack/Teams attachment uploads) actually use. Reuses the stdlib
`email` package's MIME parser to split parts by boundary (RFC 2046 is a
strict subset of RFC 822 MIME, so this "wrap it in a fake email" trick is a
standard, well-tested technique — not a hand-rolled boundary parser) rather
than writing one by hand.

This is where the historical "wrong filename" bug actually gets fixed: each
part carries its OWN real Content-Disposition filename, unlike the agent's
old best-effort guess from the outer request's URL path.
"""

from __future__ import annotations

import io
from email import message_from_bytes, policy
from typing import Iterable

from .base import ExtractContext, Item, Segment, Unscannable
from ..charset import decode_best_effort


def extract(stream, part: str, filename: str, content_type: str, ctx: ExtractContext) -> Iterable[Item]:
    from . import engine  # local import: engine imports this module too

    raw = stream.read()
    ctx.check_budget(len(raw))

    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii", "replace")
    msg = message_from_bytes(header + raw, policy=policy.compat32)

    if not msg.is_multipart():
        yield Unscannable(part=part, reason="corrupt", detail="multipart boundary parse failed")
        return

    for i, sub in enumerate(msg.get_payload()):
        sub_filename = sub.get_filename()
        field_name = sub.get_param("name", header="content-disposition") or f"field{i}"
        sub_mime = sub.get_content_type()
        payload = sub.get_payload(decode=True) or b""
        ctx.check_budget(len(payload))

        if sub_filename:
            # A real file part — recurse through the normal dispatcher so it
            # gets identical treatment to a direct upload of the same file,
            # tagged with its real filename this time.
            sub_part = f"{part}!{sub_filename}"
            child = ctx.child()
            try:
                yield from engine.dispatch(io.BytesIO(payload), sub_part, sub_filename, sub_mime, child)
            finally:
                ctx.absorb(child)
        else:
            # A plain form field — its value is exactly what a chat message
            # or simple form post carries.
            yield Segment(part=f"{part}!{field_name}", filename=field_name,
                          mime=sub_mime or "text/plain", source="multipart_field",
                          text=decode_best_effort(payload))
