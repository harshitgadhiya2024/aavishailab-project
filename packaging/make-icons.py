#!/usr/bin/env python3
"""Renders the Aavishield app icon into the formats each installer needs.

    python3 packaging/make-icons.py

Writes packaging/icons/aavishield.icns (macOS) and .ico (Windows). The
outputs are committed so a build never depends on this running — but the
source of truth is code rather than a binary somebody has to open an editor
to change, and re-running it reproduces both files exactly.

Kept deliberately free of iconutil: that only exists on macOS, and the icons
have to be regenerable from any machine.
"""

import os
import struct
import sys

from PIL import Image, ImageDraw

BRAND = (255, 112, 0)        # #FF7000, the same brand-500 the portal uses
BRAND_DEEP = (198, 86, 0)    # a shade under brand-600 for the gradient's foot
GLYPH = (255, 255, 255)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")

# The shield from the UI (lucide's, as used in main.html), in its native 24x24
# space so the app icon and the in-window glyph are unmistakably the same mark.
SHIELD_TOP = (12.0, 2.0)
SHIELD_R_TOP, SHIELD_R_MID = (20.0, 5.0), (20.0, 12.0)
SHIELD_TIP = (12.0, 22.0)
SHIELD_L_MID, SHIELD_L_TOP = (4.0, 12.0), (4.0, 5.0)


def _quad(p0, p1, p2, steps=24):
    """Samples a quadratic bezier — the shield's lower flanks are curves, and
    a straight line there reads as a pentagon rather than a shield."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    return out


def shield_points(size, inset):
    """The shield outline scaled into a `size` box with `inset` padding."""
    span = size - 2 * inset
    scale = span / 24.0

    pts = [SHIELD_TOP, SHIELD_R_TOP, SHIELD_R_MID]
    pts += _quad(SHIELD_R_MID, (20.0, 18.2), SHIELD_TIP)[1:]
    pts += _quad(SHIELD_TIP, (4.0, 18.2), SHIELD_L_MID)[1:]
    pts += [SHIELD_L_TOP]
    return [(inset + x * scale, inset + y * scale) for x, y in pts]


def render(size):
    """One square icon at `size` px: brand-gradient rounded square, white shield."""
    # Supersampled 4x and downscaled — the curves and the corner radius are
    # what make it read as a real app icon rather than a screenshot of one.
    ss = 4
    n = size * ss
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    # macOS leaves ~10% breathing room around the rounded square; matching it
    # keeps the icon the same visual weight as its neighbours in the Dock.
    pad = int(n * 0.085)
    box = (pad, pad, n - pad, n - pad)
    radius = int((n - 2 * pad) * 0.225)   # Big Sur-era squircle proportion

    grad = Image.new("RGBA", (n, n))
    gd = ImageDraw.Draw(grad)
    for y in range(n):
        t = y / max(n - 1, 1)
        gd.line([(0, y), (n, y)], fill=(
            round(BRAND[0] + (BRAND_DEEP[0] - BRAND[0]) * t),
            round(BRAND[1] + (BRAND_DEEP[1] - BRAND[1]) * t),
            round(BRAND[2] + (BRAND_DEEP[2] - BRAND[2]) * t),
            255,
        ))

    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    # Inset tuned for the 16px case: the Dock and the menu bar are where this
    # is smallest, and a daintier glyph turns to mush there.
    ImageDraw.Draw(img).polygon(shield_points(n, int(n * 0.255)), fill=GLYPH)
    return img.resize((size, size), Image.LANCZOS)


# ICNS type codes paired with the pixel size each one carries. Written by hand
# rather than via Pillow's ICNS writer, which is macOS-only in most builds.
ICNS_TYPES = [
    (b"icp4", 16), (b"icp5", 32), (b"ic07", 128), (b"ic08", 256),
    (b"ic09", 512), (b"ic10", 1024), (b"ic11", 32), (b"ic12", 64),
    (b"ic13", 256), (b"ic14", 512),
]


def write_icns(path):
    import io
    chunks = b""
    for code, size in ICNS_TYPES:
        buf = io.BytesIO()
        render(size).save(buf, format="PNG")
        payload = buf.getvalue()
        chunks += code + struct.pack(">I", len(payload) + 8) + payload
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


def write_ico(path):
    sizes = [16, 24, 32, 48, 64, 128, 256]
    render(256).save(path, format="ICO", sizes=[(s, s) for s in sizes])


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    icns, ico = os.path.join(OUT_DIR, "aavishield.icns"), os.path.join(OUT_DIR, "aavishield.ico")
    write_icns(icns)
    write_ico(ico)
    png = os.path.join(OUT_DIR, "aavishield-1024.png")
    render(1024).save(png)
    for p in (icns, ico, png):
        print(f"  {os.path.relpath(p)}  {os.path.getsize(p):,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
