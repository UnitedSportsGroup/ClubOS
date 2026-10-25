#!/usr/bin/env python3
"""Trim the transparent margins off each brand crest for the Mailer.

    python3 script/build-mailer-crests.py

The files in client/public/logos/ draw the sidebar, the login page and the
rest of ClubOS, and several carry a wide transparent border (the CUFC crest is
a 1000×1000 canvas with the artwork on 77% of its width; the CIC crest wastes
11% on every side). In an email that border is paid for twice: the row has to
be tall enough for the whole canvas, and the artwork inside it draws small.
Daniel, 2026-10-26: "less empty space around the logo, allowing it to be
bigger without actually taking up more space."

So the Mailer gets its OWN copies in client/public/mailer/crests/: trimmed to
the artwork's alpha bounding box, shrunk to 320px on the long side (a crest is
drawn at 64px, so 320 covers a 3× screen with room), re-encoded. The originals
are untouched. The script prints, per crest, the width that gives a 64px-tall
crest at the trimmed aspect — those numbers are the `crestWidth`s in
grapes/templates/brand-kit.ts.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "client" / "public" / "logos"
OUT = ROOT / "client" / "public" / "mailer" / "crests"
LONG_SIDE = 320
CREST_HEIGHT = 64  # the header draws a crest 64px tall; a wordmark is sized by width instead

# mailer key → source file. The United Prints wordmark and the MFL crest are
# already tight, but they come through the same path so every Mailer crest is
# one folder and one size rule.
CRESTS = {
    "siu": "south-island-united.png",
    "cufc": "christchurch-united.png",
    "cugc": "united-gymnastics.png",
    "mfl": "mini-football-leagues-crest.png",  # mini-football-leagues.png is the same artwork on a 500px canvas
    "cic": "christchurch-international-cup.png",
    "usg": "united-sports-group-royal.png",
    "prints": "united-prints-wordmark.png",
}


def trim(im: Image.Image) -> Image.Image:
    alpha = im.getchannel("A").point(lambda a: 255 if a > 8 else 0)
    box = alpha.getbbox()
    return im.crop(box) if box else im


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"{'crest':14s} {'source':14s} {'artwork':10s} {'saved':9s} {'size':6s}  width for {CREST_HEIGHT}px tall")
    for key, name in CRESTS.items():
        src = SRC / name
        im = Image.open(src).convert("RGBA")
        w0, h0 = im.size
        art = trim(im)
        w, h = art.size
        scale = min(1.0, LONG_SIDE / max(w, h))
        if scale < 1.0:
            art = art.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        dest = OUT / f"{key}.png"
        # The originals are 256-colour PNGs; a full-colour re-encode of the trim
        # came out 2× their size, and an email loads the crest in the header AND
        # the footer. Quantise the same way (octree keeps the alpha edge).
        art.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(dest, optimize=True)
        width_for_height = round(CREST_HEIGHT * w / h)
        print(
            f"{key:14s} {w0}x{h0:<8d} {w}x{h:<6d} {art.size[0]}x{art.size[1]:<5d} {dest.stat().st_size // 1024:>4d}KB  "
            f"{width_for_height}px (aspect {w / h:.2f}, was {src.stat().st_size // 1024}KB)"
        )


if __name__ == "__main__":
    main()
