#!/usr/bin/env python3
"""Compare the horizontal bands of each page by reading the rendered pixels.

    python3 scripts/profile-bands.py            # every page
    python3 scripts/profile-bands.py hcls       # one

Reads the live plates from `public/reference/` and our captures from
`.compare/ours/` (write those with `compare-pages.mjs`).

## Why this reads pixels instead of the DOM

The first version of this walked the DOM looking for full-width blocks. It was
useless: the live site is Elementor, so a single visual band is four nested
wrappers whose boxes differ by a few pixels, and the tool reported 23 "bands" for
a page that has about 8 — most of them unnamed duplicates of each other. There is
no structural correspondence between a WordPress page and a React one, so any
method that starts from markup inherits that mess.

Pixels have no such problem. A band *is* a run of rows sharing an edge colour,
whatever produced it. Sampling the left edge of the full-page screenshot and
grouping the runs gives the page's real visual rhythm — how many bands, what
colour, and crucially **how tall** — which is what has to match for two pages to
line up, and what none of the other tools measured.

## Reading the output

Bands are listed top to bottom for each side, then paired in order. A `+` delta
means ours is taller. Where the two lists diverge in *count*, pairing by position
stops meaning much — that is called out rather than papered over, because a
different number of bands is a bigger finding than any height delta.
"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
LIVE_DIR = HERE.parent / "public" / "reference"
OURS_DIR = HERE.parent.parent.parent / ".compare" / "ours"

SAMPLES = 64      # horizontal samples per row
MIN_BAND = 28     # runs shorter than this are noise, not a band
TOL = 12          # per-channel tolerance when deciding "same colour"

PAGES = ["home", "speakers", "about", "team", "community",
         "hcls", "tickets", "blog", "learn", "agenda", "awards"]


def row_colours(path: Path) -> list[tuple[int, int, int]]:
    """A background estimate for every row: the median across the full width.

    Not the left edge, which the first version of this used. That breaks on any
    band with a full-bleed image or a wave graphic at x=0 — /about and /team both
    have one — and it reported those heroes as three or four bands of shifting
    colour. Taking the median across 64 samples spanning the whole width ignores
    the content column (text is sparse, so most samples are still background) and
    still tracks a photographic band as one band.
    """
    im = Image.open(path).convert("RGB")
    small = im.resize((SAMPLES, im.height), Image.Resampling.BOX)
    px = small.load()
    out = []
    for y in range(im.height):
        chans = []
        for ch in range(3):
            vals = sorted(px[x, y][ch] for x in range(SAMPLES))
            chans.append(vals[SAMPLES // 2])
        out.append(tuple(chans))
    return out


def close(a, b) -> bool:
    return all(abs(x - y) <= TOL for x, y in zip(a, b))


def bands(path: Path) -> list[tuple[tuple[int, int, int], int, int]]:
    """Runs of near-constant edge colour: (rgb, top, height)."""
    rows = row_colours(path)
    out: list[list] = []
    for y, c in enumerate(rows):
        if out and close(out[-1][0], c):
            out[-1][2] += 1
        else:
            out.append([c, y, 1])
    merged = [b for b in out if b[2] >= MIN_BAND]
    # Fold a short run back into its predecessor so anti-aliased seams between
    # two bands do not read as a third band.
    folded: list[list] = []
    for b in merged:
        if folded and close(folded[-1][0], b[0]):
            folded[-1][2] += b[2]
        else:
            folded.append(b)
    return [(tuple(c), top, h) for c, top, h in folded]


def hexs(c) -> str:
    return "#%02x%02x%02x" % c


def report(name: str) -> None:
    lp, op = LIVE_DIR / f"{name}-1440.webp", OURS_DIR / f"{name}-1440.webp"
    if not lp.exists() or not op.exists():
        print(f"\n## {name}: missing {(lp if not lp.exists() else op).name}")
        return

    lb, ob = bands(lp), bands(op)
    print(f"\n## {name}   live {len(lb)} bands · ours {len(ob)} bands")
    if len(lb) != len(ob):
        print(f"  ! band COUNT differs ({len(lb)} vs {len(ob)}) — pairing below is by position only")

    for i in range(max(len(lb), len(ob))):
        l = lb[i] if i < len(lb) else None
        o = ob[i] if i < len(ob) else None
        if l and o:
            dh = o[2] - l[2]
            flag = "" if abs(dh) < 20 and close(l[0], o[0]) else "  <-- "
            colour = f"{hexs(l[0])} / {hexs(o[0])}" if not close(l[0], o[0]) else hexs(l[0])
            print(f"  {i:2}  {colour:>18}  live h={l[2]:<5} ours h={o[2]:<5} {dh:+}{flag}")
        elif l:
            print(f"  {i:2}  {hexs(l[0]):>18}  live h={l[2]:<5} ours —        (live has an extra band)")
        else:
            print(f"  {i:2}  {hexs(o[0]):>18}  live —        ours h={o[2]:<5} (ours has an extra band)")


if __name__ == "__main__":
    for n in sys.argv[1:] or PAGES:
        report(n)
