"""Build one contact sheet (HTML and PNG) from a folder of screenshots.

Usage: python3 contact-sheet.py <screenshot-dir> <title>
Writes <screenshot-dir>/contact-sheet.html and contact-sheet.png. Each image is
labelled with its file name, which is the screen's route, so a reviewer can tell
which deep link produced it.
"""
import html
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

folder = Path(sys.argv[1])
title = sys.argv[2] if len(sys.argv) > 2 else folder.name
shots = sorted(p for p in folder.glob("*.png") if p.name != "contact-sheet.png")
if not shots:
    sys.exit(f"no screenshots in {folder}")

cards = "\n".join(
    f'<figure><img src="{html.escape(p.name)}" alt="{html.escape(p.stem)}"><figcaption>{html.escape(p.stem)}</figcaption></figure>'
    for p in shots
)
(folder / "contact-sheet.html").write_text(
    f"""<!doctype html><meta charset="utf-8"><title>{html.escape(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{{font:14px -apple-system,system-ui,sans-serif;margin:16px;background:#f3f4f6;color:#111}}
h1{{font-size:18px}}main{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}}
figure{{margin:0;background:#fff;border-radius:12px;padding:8px;box-shadow:0 1px 3px #0002}}
img{{width:100%;border-radius:8px;display:block}}figcaption{{margin-top:6px;font-size:12px;color:#444;word-break:break-all}}</style>
<h1>{html.escape(title)}</h1><main>{cards}</main>
""",
    encoding="utf-8",
)

thumb_w = 300
font = ImageFont.load_default()
thumbs = []
for p in shots:
    im = Image.open(p).convert("RGB")
    im = im.resize((thumb_w, round(im.height * thumb_w / im.width)))
    thumbs.append((p.stem, im))
cols = 6
cell_h = max(t.height for _, t in thumbs) + 28
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (thumb_w + 16) + 16, rows * (cell_h + 16) + 56), "#f3f4f6")
draw = ImageDraw.Draw(sheet)
draw.text((16, 16), title, fill="#111", font=font)
for i, (name, im) in enumerate(thumbs):
    x = 16 + (i % cols) * (thumb_w + 16)
    y = 48 + (i // cols) * (cell_h + 16)
    sheet.paste(im, (x, y))
    draw.text((x, y + im.height + 6), name, fill="#333", font=font)
sheet.save(folder / "contact-sheet.png")
print(f"{len(shots)} screenshots -> {folder / 'contact-sheet.html'} and contact-sheet.png")
