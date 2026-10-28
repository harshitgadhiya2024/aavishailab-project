#!/usr/bin/env python3
"""Builds every Aavishield connector icon from the website's brand files.

    python3 packaging/make-icons.py      (needs Pillow and cairosvg)

Source of truth is the same artwork the website and dashboards use, so the
connector can't drift from them again:
  - frontend/website/public/brand/mark.svg  -> app icons, tray, window icon
                                               (the favicon is this mark too)
  - the mark plus "Aavishield" in Sora SemiBold, white, for the dark window
    header — the lockup website/src/components/wordmark.tsx sets in live
    text. Sora ships next to this script (packaging/icons/fonts/, OFL).

Writes:
  packaging/icons/aavishield.icns           macOS app bundle icon
  packaging/icons/aavishield.ico            Windows .exe and installer icon
  packaging/icons/aavishield-<n>.png        Linux hicolor icons (48..512) + 1024
  services/endpoint-agent/assets/mark-256.png   tray + window icon
  services/endpoint-agent/assets/logo-dark.png  window header logo
  frontend/company-dashboard/public/brand/logo-email.png  email header logo

The outputs are committed so a build never depends on this running. ICNS is
written by hand so this works on any OS (no iconutil).
"""

import io
import os
import struct
import sys

import cairosvg
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARK_SVG = os.path.join(ROOT, "frontend", "website", "public", "brand", "mark.svg")
SORA = os.path.join(ROOT, "packaging", "icons", "fonts", "Sora[wght].ttf")
ICON_DIR = os.path.join(ROOT, "packaging", "icons")
ASSET_DIR = os.path.join(ROOT, "services", "endpoint-agent", "assets")
# Served at app.aavishield.com/brand/logo-email.png.
EMAIL_LOGO = os.path.join(ROOT, "frontend", "company-dashboard", "public", "brand", "logo-email.png")


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


# Rasterized well above the largest output (1024) so every size is a
# downscale of the vector, never an upscale.
MARK = trim(Image.open(io.BytesIO(cairosvg.svg2png(url=MARK_SVG, output_width=2048))).convert("RGBA"))


def render(size):
    # A little breathing room so the mark sits at the same visual weight as
    # neighbouring icons in the Dock, taskbar and app menus.
    return square(MARK, size, pad=0.06)


def logo_dark(width=840, height=280):
    """The website lockup in white on transparent, on the original 3:1
    canvas brand.rs's test pins."""
    return lockup((255, 255, 255, 255), width, height, fill=0.84, inset=None)


def lockup(ink, width, height, fill, inset):
    """The website lockup — proportions are wordmark.tsx's: the mark 1.22em
    tall and 0.28em from the word — with the word in `ink`, scaled to `fill`
    of the canvas width and centred, or placed `inset` of the width in."""
    em = 300
    font = ImageFont.truetype(SORA, em)
    font.set_variation_by_axes([600])  # SemiBold
    mark = MARK.resize((round(MARK.width * 1.22 * em / MARK.height), round(1.22 * em)), Image.LANCZOS)
    left, top, right, bottom = font.getbbox("Aavishield")
    gap = round(0.28 * em)
    canvas = Image.new("RGBA", (mark.width + gap + right, max(mark.height, bottom)), (0, 0, 0, 0))
    canvas.paste(mark, (0, (canvas.height - mark.height) // 2), mark)
    # Centre the word's ink on the mark, as the flex `items-center` does.
    ImageDraw.Draw(canvas).text((mark.width + gap, (canvas.height - (top + bottom)) // 2),
                                "Aavishield", font=font, fill=ink)
    art = trim(canvas)
    scale = min(width * fill / art.width, height * 0.6 / art.height)
    art = art.resize((round(art.width * scale), round(art.height * scale)), Image.LANCZOS)
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    x = (width - art.width) // 2 if inset is None else round(width * inset)
    out.paste(art, (x, (height - art.height) // 2), art)
    return out


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

    # The connector window is dark (#111), so it uses the white wordmark.
    # 840px wide covers a ~210pt header on a 4x display.
    p = os.path.join(ASSET_DIR, "logo-dark.png")
    logo_dark().save(p, optimize=True)
    out.append(p)

    # Email header (mailer/templates.go): dark word for the white card, 3x
    # the template's 240x80 slot, left-aligned like the row it sits in.
    # Email clients can't render the SVG logo the web apps use.
    p = EMAIL_LOGO
    lockup((0x0B, 0x0B, 0x0D, 255), 720, 240, fill=0.94, inset=0.02).save(p, optimize=True)
    out.append(p)

    for p in out:
        print(f"  {os.path.relpath(p, ROOT)}  {os.path.getsize(p):,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
