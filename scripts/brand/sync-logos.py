#!/usr/bin/env python3
"""Copies the Aavishield brand artwork from logos/ into every app.

    python3 scripts/brand/sync-logos.py        (needs Pillow and numpy)

Source of truth is the repo-root logos/ folder (the files the brand team
supplies). Each logo keeps its ORIGINAL canvas and proportions — the empty
margin around the artwork is part of the lockup and is not trimmed. Only the
solid white/black background is made transparent, with a soft ramp that
leaves every pixel of the artwork itself unchanged.

Writes, into each app's public/brand/ (website, company-dashboard,
employee-portal, superadmin, docs):
  logo-horizontal-tagline-light.png / -dark.png   the logo used everywhere
  logo-horizontal-light.png / -dark.png           without tagline
  logo-stacked-light.png, logo-stacked-tagline-light.png
  mark.png, mark-on-dark.png                      the shield mark alone

It prints the final pixel size of every lockup. If a new logo file has a
different shape (aspect ratio), update the width/height numbers in:
  frontend/*/src/components/brand/BrandLogo.tsx, frontend/website/src/components/wordmark.tsx
"""

import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOGOS = os.path.join(ROOT, "logos")
APPS = ["website", "company-dashboard", "employee-portal", "superadmin", "docs"]
WHITE, BLACK = (255, 255, 255), (0, 0, 0)


def knockout(img, bg, t1=22.0, t2=70.0):
    """Background -> transparent. Within t1 of `bg`: clear; beyond t2: fully
    opaque and untouched; between: the background is un-mixed out of the
    anti-aliased edge so it stays clean on any backdrop."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    b = np.array(bg, dtype=np.float32)
    d = np.sqrt(((a - b) ** 2).sum(axis=2))
    alpha = np.clip((d - t1) / (t2 - t1), 0, 1)
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((a - (1 - alpha[..., None]) * b) / safe, 0, 255)
    return Image.fromarray(np.dstack([fg, alpha * 255]).astype(np.uint8), "RGBA")


def load(name, bg):
    return knockout(Image.open(os.path.join(LOGOS, name)), bg)


def width(img, w):
    """Scale to width `w`, keeping the original proportions exactly."""
    return img.resize((w, round(img.height * w / img.width)), Image.LANCZOS)


def mark(name, bg):
    """The shield alone, centred on a square (the favicon art is square already;
    trimming then re-squaring just evens out its margins)."""
    img = load(name, bg)
    img = img.crop(img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())
    side = max(img.size)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    return out.resize((512, 512), Image.LANCZOS)


def main():
    lockups = {
        "logo-horizontal-tagline-light.png": width(load("white-theme-sideview-with-tagline.png", WHITE), 1400),
        "logo-horizontal-tagline-dark.png": width(load("black-theme-sideview-with-tagline.png", BLACK), 1400),
        "logo-horizontal-light.png": width(load("white-theme-sideview-without-tagline.png", WHITE), 1400),
        "logo-horizontal-dark.png": width(load("black-theme-sideview-without-tagline.png", BLACK), 1400),
        "logo-stacked-light.png": width(load("white-theme-main-logo-without-tagline.png", WHITE), 1000),
        "logo-stacked-tagline-light.png": width(load("white-theme-main-logo-with-tagline.png", WHITE), 1000),
        "mark.png": mark("favicon-white-theme.png", WHITE),
        "mark-on-dark.png": mark("favicon-black-theme.png", BLACK),
    }
    for app in APPS:
        out = os.path.join(ROOT, "frontend", app, "public", "brand")
        os.makedirs(out, exist_ok=True)
        for name, img in lockups.items():
            img.save(os.path.join(out, name), optimize=True)
    # Small mark the website's first-visit loader paints before any JS.
    lockups["mark.png"].resize((192, 192), Image.LANCZOS).save(
        os.path.join(ROOT, "frontend", "website", "public", "brand", "mark-192.png"), optimize=True)

    # The connector's artwork comes from packaging/make-icons.py, which builds
    # it from the website's current brand files rather than logos/.

    for name, img in lockups.items():
        print(f"  {name:36s} {img.width}x{img.height}  ({img.width / img.height:.2f}:1)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
