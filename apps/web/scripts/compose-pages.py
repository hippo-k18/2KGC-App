#!/usr/bin/env python3
"""Stitch each live plate beside our capture of the same page.

    python3 scripts/compose-pages.py            # every page
    python3 scripts/compose-pages.py tickets    # one

Reads live plates from `public/reference/` and our shots from `.compare/ours/`
(written by `compare-pages.mjs`), and writes `.compare/<name>.png`.

Two decisions here matter for reading the result:

**Both halves are scaled to the same *width*, never to the same height.** The two
pages are different lengths — that is itself one of the things worth seeing — and
normalising height would hide it while silently changing every proportion.

**A page taller than `MAX_H` is split into numbered chunks** rather than squashed.
A 14,000px homepage scaled to fit one image is unreadable, and the whole purpose
is to compare things like type size and band colour that only survive at a
legible scale.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
LIVE_DIR = HERE.parent / "public" / "reference"
OUT_DIR = HERE.parent.parent.parent / ".compare"
OURS_DIR = OUT_DIR / "ours"

HALF_W = 700          # drawn width of each column
GUTTER = 24
LABEL_H = 34
MAX_H = 2600          # per chunk, before splitting

PAGES = [
    "home", "speakers", "about", "team", "community",
    "hcls", "tickets", "blog", "learn", "agenda", "awards",
]


def scaled(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB")
    h = max(1, round(im.height * HALF_W / im.width))
    return im.resize((HALF_W, h), Image.Resampling.LANCZOS)


def compose(name: str) -> list[Path]:
    live_p = LIVE_DIR / f"{name}-1440.webp"
    ours_p = OURS_DIR / f"{name}-1440.webp"
    if not live_p.exists() or not ours_p.exists():
        missing = live_p if not live_p.exists() else ours_p
        print(f"skip  {name}: missing {missing.name}")
        return []

    live, ours = scaled(live_p), scaled(ours_p)
    total = max(live.height, ours.height)
    written = []

    chunks = max(1, -(-total // MAX_H))  # ceil
    for i in range(chunks):
        top, bot = i * MAX_H, min((i + 1) * MAX_H, total)
        band = bot - top
        canvas = Image.new("RGB", (HALF_W * 2 + GUTTER, band + LABEL_H), "white")

        for col, (im, label) in enumerate(((live, "LIVE"), (ours, "OURS"))):
            x = col * (HALF_W + GUTTER)
            if top < im.height:
                crop = im.crop((0, top, HALF_W, min(bot, im.height)))
                canvas.paste(crop, (x, LABEL_H))
            else:
                # Past the end of the shorter page: mark it rather than leave
                # white, so "this page simply stops here" is not read as a bug.
                d = ImageDraw.Draw(canvas)
                d.rectangle([x, LABEL_H, x + HALF_W, band + LABEL_H], fill=(238, 238, 238))
                d.text((x + 12, LABEL_H + 12), f"({label.lower()} ends above)", fill=(120, 120, 120))

        d = ImageDraw.Draw(canvas)
        d.rectangle([0, 0, canvas.width, LABEL_H], fill=(20, 22, 28))
        part = f"  part {i + 1}/{chunks}" if chunks > 1 else ""
        d.text((10, 10), f"LIVE  {name}{part}", fill=(255, 255, 255))
        d.text((HALF_W + GUTTER + 10, 10), f"OURS  {name}{part}", fill=(255, 255, 255))

        out = OUT_DIR / (f"{name}-{i + 1}.png" if chunks > 1 else f"{name}.png")
        canvas.save(out)
        written.append(out)

    print(f"ok    {name}: live {live.height}px vs ours {ours.height}px -> {len(written)} image(s)")
    return written


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    targets = sys.argv[1:] or PAGES
    for n in targets:
        compose(n)
