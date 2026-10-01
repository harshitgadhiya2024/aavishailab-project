#!/usr/bin/env python3
"""Builds every Aavishield connector icon from the brand favicon.

    python3 packaging/make-icons.py      (needs Pillow and numpy)

Source of truth is the brand artwork in logos/ at the repo root:
  - favicon-white-theme.png                 -> app icons (.icns, .ico, PNGs)
  - black-theme-sideview-with-tagline.png   -> the logo in the connector window

Both ship on a solid background. That background is removed with a soft
colour-to-alpha ramp that leaves every pixel of the artwork itself untouched
(compositing the result back onto the original background reproduces the
source to within the background's own noise), then the result is trimmed.

Writes:
  packaging/icons/aavishield.icns           macOS app bundle icon
  packaging/icons/aavishield.ico            Windows .exe and installer icon
  packaging/icons/aavishield-<n>.png        Linux hicolor icons (48..512) + 1024
  services/endpoint-agent/assets/mark-256.png          tray + window icon
  services/endpoint-agent/assets/logo-tagline-dark.png window header logo

The outputs are committed so a build never depends on this running. ICNS is
written by hand so this works on any OS (no iconutil).
"""

import io
import os
import struct
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGOS = os.path.join(ROOT, "logos")
ICON_DIR = os.path.join(ROOT, "packaging", "icons")
ASSET_DIR = os.path.join(ROOT, "services", "endpoint-agent", "assets")

WHITE, BLACK = (255, 255, 255), (0, 0, 0)


def knockout(img, bg, t1=22.0, t2=70.0):
    """Pixels within t1 of `bg` become transparent, beyond t2 stay opaque, and
    the ramp between them has the background un-mixed from its colour, so
    anti-aliased edges stay clean on any backdrop."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    b = np.array(bg, dtype=np.float32)
    d = np.sqrt(((a - b) ** 2).sum(axis=2))
    alpha = np.clip((d - t1) / (t2 - t1), 0, 1)
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((a - (1 - alpha[..., None]) * b) / safe, 0, 255)
    return Image.fromarray(np.dstack([fg, alpha * 255]).astype(np.uint8), "RGBA")


def trim(img):
    return img.crop(img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())


def square(img, size, pad):
    """`img` centred on a transparent square of `size`, `pad` of it each side."""
    inner = int(size * (1 - 2 * pad))
    scale = inner / max(img.size)
    im = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return out


MARK = trim(knockout(Image.open(os.path.join(LOGOS, "favicon-white-theme.png")), WHITE))


def render(size):
    # A little breathing room so the mark sits at the same visual weight as
    # neighbouring icons in the Dock, taskbar and app menus.
    return square(MARK, size, pad=0.06)


ICNS_TYPES = [
    (b"icp4", 16), (b"icp5", 32), (b"ic07", 128), (b"ic08", 256),
    (b"ic09", 512), (b"ic10", 1024), (b"ic11", 32), (b"ic12", 64),
    (b"ic13", 256), (b"ic14", 512),
]


def write_icns(path):
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
    os.makedirs(ICON_DIR, exist_ok=True)
    os.makedirs(ASSET_DIR, exist_ok=True)
    out = []

    p = os.path.join(ICON_DIR, "aavishield.icns"); write_icns(p); out.append(p)
    p = os.path.join(ICON_DIR, "aavishield.ico"); write_ico(p); out.append(p)
    for s in (48, 128, 256, 512, 1024):
        p = os.path.join(ICON_DIR, f"aavishield-{s}.png")
        render(s).save(p, optimize=True)
        out.append(p)

    p = os.path.join(ASSET_DIR, "mark-256.png")
    square(MARK, 256, pad=0.02).save(p, optimize=True)
    out.append(p)

    # The connector window is dark (#111), so it uses the white-wordmark
    # lockup. 840px wide covers a ~210pt header on a 4x display.
    logo = trim(knockout(Image.open(os.path.join(LOGOS, "black-theme-sideview-with-tagline.png")), BLACK))
    logo = logo.resize((840, round(logo.height * 840 / logo.width)), Image.LANCZOS)
    p = os.path.join(ASSET_DIR, "logo-tagline-dark.png")
    logo.save(p, optimize=True)
    out.append(p)

    for p in out:
        print(f"  {os.path.relpath(p, ROOT)}  {os.path.getsize(p):,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
