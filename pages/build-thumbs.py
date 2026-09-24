#!/usr/bin/env python3
"""Build the web-sized copies of the screenshots the showcase page loads.

The captures in app/docs/screenshots are the real thing at the real
resolution - 14-authority.png is 2.1 MB at 2560x1720 - and the lightbox still
opens exactly that file. What the page does NOT need is 2.1 MB to fill a
gallery tile that renders 158 px wide on a handset, or a device frame that is
never wider than about 700 px. Sending the originals to those places costs
roughly 5.9 MB of PNG, which on a phone over mobile data is the difference
between a page that opens and a page somebody closes.

Three tiers, all WebP, all a plain LANCZOS downscale of the original:

  hd/      up to 2560 px - only for captures wider than 1400, offered to 2x
           screens through srcset and never downloaded by a phone
  stage/   1400 px wide - the device frames, the hero, the video posters,
           and the desktop-capture gallery tiles, which render up to 536 px
           wide and so need about 1100 px to stay sharp on a retina screen
  thumbs/   520 px wide for the portrait captures - the phone gallery tiles,
           which never render wider than 258 px. Landscape captures get an
           880 px copy here too, for a smaller tile if one is ever added.

Nothing is retouched, cropped or composited. The page says these are real
screenshots of the running system and they have to stay exactly that; scaling
a copy down to the size it is displayed at is not a claim about the software.

Compression: lossless unless that costs more than the cap, in which case
quality 90. On flat UI screenshots lossless WebP is usually the smaller of the
two anyway; on the handful with gradients and a rendered map it is several
times larger, and at tile size q90 is indistinguishable - with the untouched
PNG one tap away in the lightbox.

Run after adding or re-taking a screenshot:

    python pages/build-thumbs.py [--force] [--from DIR]

--from reads the PNGs from DIR instead of app/docs/screenshots (the copies
are still written there). Use it to build from the committed captures while
an uncommitted re-capture is sitting in the working tree, so a tile and the
lightbox original it opens are always the same capture.

Idempotent: a copy newer than its source is left alone, so a second run is
free.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "app" / "docs" / "screenshots"

# (directory, max width for a landscape capture, max width for a portrait
#  capture, the size above which lossless is abandoned for quality 90, and the
#  source width a capture must exceed to get a copy in this tier at all)
#
# hd/ exists for retina laptops and big monitors: a 1400 px copy in a 1100 px
# box on a 2x screen is visibly soft. Only captures wider than the stage tier
# get one - there is nothing sharper to give a 780 px phone capture - and the
# page offers it through srcset, so a phone never downloads it.
TIERS = [
    ("hd", 2560, 0, 220 * 1024, 1400),
    ("stage", 1400, 900, 120 * 1024, 0),
    ("thumbs", 880, 520, 60 * 1024, 0),
]


def encode(im: Image.Image, cap: int) -> bytes:
    lossless = io.BytesIO()
    im.save(lossless, "WEBP", lossless=True, quality=100, method=4)
    if lossless.tell() <= cap:
        return lossless.getvalue()
    lossy = io.BytesIO()
    im.save(lossy, "WEBP", quality=90, method=4)
    # Belt and braces: if the "cheaper" encoding is not actually cheaper,
    # keep the lossless one. Never pay in fidelity for nothing.
    return lossy.getvalue() if lossy.tell() < lossless.tell() else lossless.getvalue()


def build(force: bool = False, src: Path = SRC) -> int:
    if not src.is_dir():
        print(f"no screenshots at {src}", file=sys.stderr)
        return 1

    total_src = total_out = 0
    for name, wide_w, tall_w, cap, min_src in TIERS:
        out_dir = SRC / name
        out_dir.mkdir(exist_ok=True)
        built = kept = tier_bytes = 0
        print(f"\n{name}/")

        for path in sorted(src.glob("*.png")):
            stem = path.stem
            dest = out_dir / (stem + ".webp")
            if not force and dest.exists() and dest.stat().st_mtime >= path.stat().st_mtime:
                kept += 1
                tier_bytes += dest.stat().st_size
                continue

            with Image.open(path) as im:
                if im.width <= min_src or (im.height > im.width and not tall_w):
                    continue
                # Decide by the capture's own shape rather than by a list of
                # names: a landscape capture squeezed into the portrait width
                # loses the text the tile exists to show.
                want = tall_w if im.height > im.width else wide_w
                if im.width > want:
                    im = im.resize(
                        (want, round(im.height * want / im.width)), Image.LANCZOS
                    )
                # A source already narrower than the target is left at its own
                # size - upscaling adds bytes and invents detail nobody
                # captured - but still re-encoded, so every reference can point
                # at this directory without a per-file exception.
                data = encode(im.convert("RGB"), cap)

            dest.write_bytes(data)
            built += 1
            tier_bytes += len(data)
            print(f"  {stem + '.png':26s} {path.stat().st_size/1024:7.0f} KB -> {len(data)/1024:6.0f} KB")

        print(f"  {built} built, {kept} current, {tier_bytes/1024/1024:.2f} MB total")
        total_out += tier_bytes

    total_src = sum(p.stat().st_size for p in src.glob("*.png"))
    print(f"\noriginals {total_src/1024/1024:.2f} MB, web copies {total_out/1024/1024:.2f} MB")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    src = SRC
    if "--from" in args:
        src = Path(args[args.index("--from") + 1]).resolve()
    raise SystemExit(build(force="--force" in args, src=src))
