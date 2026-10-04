#!/usr/bin/env python3
"""Draw the hero backdrop: a night expressway, and render it to WebP.

The hero used to sit on an aerial photograph of the Delhi-Gurgaon stretch of
NH-48. It was a third-party photo, so it has been replaced by this original
illustration, drawn for the project from code: nothing in it is traced from,
or composited out of, anybody else's image. It is not a photograph of any real
place and the page does not present it as one.

What it shows: a divided expressway at night in perspective, its lane
markings and median streetlights, long-exposure light trails (gold headlights
coming in, red tail lights going out), cyan road studs, a distant town's glow
at the vanishing point, hills, and a signal tower whose arcs fade out - the
product's off-grid theme, where coverage gives way.

The geometry is a real pinhole projection (camera 7 m up, focal length 900 px)
so markings shorten with distance the way they would. Stars and windows use a
fixed seed, so a rebuild is byte-for-byte the same SVG.

    python pages/hero/build-hero.py            # SVG + every WebP below
    python pages/hero/build-hero.py --og FILE  # also a 1200x630 JPEG social card

Writes:
    pages/hero/hero-scene.svg          the source, 1920x1280 (committed)
    pages/hero/hero-scene-1920.webp    showcase hero, wide screens
    pages/hero/hero-scene-1080.webp    showcase hero, <= 980 px
    app/apps/web/assets/hero/hero-scene-1920.webp   the app's showcase.html

Rendering is headless Chrome (the same browser capture-screens.mjs drives) at
2x, downscaled with LANCZOS, so every edge is supersampled. Needs Pillow.
"""

from __future__ import annotations

import math
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SVG = HERE / "hero-scene.svg"
OUTPUTS = [  # (path, width, height, quality)
    (HERE / "hero-scene-1920.webp", 1920, 1280, 82),
    (HERE / "hero-scene-1080.webp", 1080, 720, 80),
    (ROOT / "app" / "apps" / "web" / "assets" / "hero" / "hero-scene-1920.webp", 1920, 1280, 82),
]

W, H = 1920, 1280
HOR = 600          # horizon, px from the top
VPX = 1100         # vanishing point, px from the left
F = 900.0          # focal length, px
CAM_H = 7.0        # camera height above the road, m
CAM_X = 2.0        # camera offset from the median, m (right of it)
Z_NEAR, Z_FAR = 7.0, 3000.0

GOLD_HI, GOLD, GOLD_LO = "#FFD978", "#F0B429", "#C97A12"   # brand/logo-mark.svg
CYAN = "#5FD0D8"                                            # the page's --cyan
TAIL, TAIL_LO = "#FF6A55", "#C8402C"


def P(x: float, y: float, z: float) -> tuple[float, float]:
    """World (lateral m, height m, depth m) to screen px."""
    return VPX + F * (x - CAM_X) / z, HOR + F * (CAM_H - y) / z


def pts(*p: tuple[float, float]) -> str:
    return " ".join(f"{a:.1f},{b:.1f}" for a, b in p)


def quad(x0: float, x1: float, y: float, z0: float, z1: float) -> str:
    """A flat strip on the plane at height y, from depth z0 to z1."""
    return pts(P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1))


def ridge(rng: random.Random, base: float, amp: float, waves: list[tuple[float, float]]) -> str:
    """A hill silhouette across the full width, closed down to y=H."""
    phase = [rng.uniform(0, 2 * math.pi) for _ in waves]
    out = [f"M0,{H}"]
    for x in range(0, W + 1, 16):
        y = base - amp * sum(a * math.sin(x / l + ph) for (l, a), ph in zip(waves, phase))
        out.append(f"L{x},{y:.1f}")
    out.append(f"L{W},{H}Z")
    return "".join(out)


def build() -> str:
    rng = random.Random(48)
    defs: list[str] = []
    body: list[str] = []
    gid = 0

    def grad(x1, y1, x2, y2, stops) -> str:
        nonlocal gid
        gid += 1
        s = "".join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in stops)
        defs.append(f'<linearGradient id="g{gid}" gradientUnits="userSpaceOnUse" '
                    f'x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}">{s}</linearGradient>')
        return f"url(#g{gid})"

    defs.append(
        '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#03050A"/><stop offset=".5" stop-color="#060A13"/>'
        '<stop offset=".82" stop-color="#0C1220"/><stop offset="1" stop-color="#1B1A1C"/></linearGradient>'
        '<radialGradient id="cityglow" cx=".5" cy=".5" r=".5">'
        f'<stop offset="0" stop-color="{GOLD}" stop-opacity=".42"/>'
        f'<stop offset=".45" stop-color="{GOLD_LO}" stop-opacity=".15"/>'
        f'<stop offset="1" stop-color="{GOLD_LO}" stop-opacity="0"/></radialGradient>'
        '<radialGradient id="cyanglow" cx=".5" cy=".5" r=".5">'
        f'<stop offset="0" stop-color="{CYAN}" stop-opacity=".16"/>'
        f'<stop offset="1" stop-color="{CYAN}" stop-opacity="0"/></radialGradient>'
        '<radialGradient id="lamp" cx=".5" cy=".5" r=".5">'
        f'<stop offset="0" stop-color="#FFF4D6" stop-opacity="1"/>'
        f'<stop offset=".18" stop-color="{GOLD_HI}" stop-opacity=".75"/>'
        f'<stop offset="1" stop-color="{GOLD}" stop-opacity="0"/></radialGradient>'
        '<radialGradient id="pool" cx=".5" cy=".5" r=".5">'
        f'<stop offset="0" stop-color="{GOLD}" stop-opacity=".2"/>'
        f'<stop offset="1" stop-color="{GOLD}" stop-opacity="0"/></radialGradient>'
        '<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="#0B0E15"/><stop offset="1" stop-color="#040508"/></linearGradient>'
        '<linearGradient id="asphalt" gradientUnits="userSpaceOnUse" x1="0" y1="600" x2="0" y2="1280">'
        '<stop offset="0" stop-color="#20242D"/><stop offset=".25" stop-color="#161A22"/>'
        '<stop offset="1" stop-color="#0D1016"/></linearGradient>'
        '<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="#E9C27A" stop-opacity="0"/>'
        f'<stop offset=".55" stop-color="#E9C27A" stop-opacity=".07"/>'
        f'<stop offset="1" stop-color="#E9C27A" stop-opacity="0"/></linearGradient>'
        # The headline sits on the left, so the scene itself is quieter there.
        '<linearGradient id="calm" x1="0" y1="0" x2="1" y2="0">'
        '<stop offset="0" stop-color="#020306" stop-opacity=".5"/>'
        '<stop offset=".48" stop-color="#020306" stop-opacity=".14"/>'
        '<stop offset=".7" stop-color="#020306" stop-opacity="0"/></linearGradient>'
        '<radialGradient id="vignette" cx=".56" cy=".46" r=".75">'
        '<stop offset=".55" stop-color="#000" stop-opacity="0"/>'
        '<stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>'
        '<filter id="blur2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>'
        '<filter id="blur6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>'
        '<filter id="blur14" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>'
        '<filter id="grain" x="0" y="0" width="100%" height="100%">'
        '<feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="48" stitchTiles="stitch"/>'
        '<feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .55 0"/></filter>'
    )

    # ── sky ────────────────────────────────────────────────────────────────
    body.append(f'<rect width="{W}" height="{HOR + 40}" fill="url(#sky)"/>')
    stars = []
    for _ in range(230):
        x, y = rng.uniform(0, W), rng.uniform(0, HOR - 90) ** 1.0
        if x < 980 and rng.random() < 0.55:      # thinner behind the headline
            continue
        r = rng.choice([0.6, 0.7, 0.8, 0.9, 1.1, 1.4])
        a = rng.uniform(0.18, 0.75) * (1 - 0.6 * y / HOR)
        stars.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="#DCE6F5" fill-opacity="{a:.2f}"/>')
    body.append("<g>" + "".join(stars) + "</g>")
    body.append(f'<ellipse cx="{VPX}" cy="{HOR - 6}" rx="1050" ry="300" fill="url(#cityglow)"/>')
    body.append(f'<ellipse cx="1700" cy="{HOR - 120}" rx="460" ry="300" fill="url(#cyanglow)"/>')

    # ── far hills, the town at the vanishing point, near hills ──────────────
    body.append(f'<path d="{ridge(rng, HOR - 26, 1, [(260, 14), (97, 6), (41, 2)])}" fill="#0D121C"/>')
    town = []
    for cluster_x, spread, tall, n, dim in [(VPX, 330, 46, 70, 1.0), (330, 260, 22, 34, 0.55), (1560, 150, 18, 18, 0.5)]:
        for _ in range(n):
            bx = cluster_x + rng.gauss(0, spread / 2.2)
            bw = rng.uniform(5, 18)
            near = math.exp(-((bx - cluster_x) / spread) ** 2)
            bh = rng.uniform(4, 10) + tall * near * rng.random()
            top = HOR + 3 - bh
            town.append(f'<rect x="{bx:.1f}" y="{top:.1f}" width="{bw:.1f}" height="{bh + 6:.1f}" fill="#0A0E17"/>')
            for wy in range(int(top) + 3, HOR, 4):
                for wx in range(int(bx) + 2, int(bx + bw) - 1, 4):
                    if rng.random() < 0.22 * dim:
                        a = rng.uniform(0.35, 0.95) * dim
                        town.append(f'<rect x="{wx}" y="{wy}" width="1.6" height="1.6" fill="{GOLD_HI}" fill-opacity="{a:.2f}"/>')
            if bh > 34 and rng.random() < 0.6:
                town.append(f'<circle cx="{bx + bw / 2:.1f}" cy="{top - 1:.1f}" r="1.3" fill="{TAIL}"/>')
    body.append("<g>" + "".join(town) + "</g>")
    body.append(f'<path d="{ridge(rng, HOR + 4, 1, [(330, 9), (120, 4), (37, 1.5)])}" fill="#080B12"/>')

    # ── the signal tower on the right-hand hill, its arcs fading ───────────
    tx, tb, tt = 1712, HOR - 2, HOR - 262
    tower = [f'<path d="M{tx - 30},{tb} L{tx - 4},{tt} M{tx + 30},{tb} L{tx + 4},{tt}" stroke="#2A3346" stroke-width="2.4" fill="none"/>']
    levels = [tb - (tb - tt) * (k / 9) ** 0.9 for k in range(10)]
    half = lambda y: 4 + 26 * (y - tt) / (tb - tt)
    for ya, yb in zip(levels, levels[1:]):
        tower.append(f'<path d="M{tx - half(ya):.1f},{ya:.1f} L{tx + half(yb):.1f},{yb:.1f} '
                     f'M{tx + half(ya):.1f},{ya:.1f} L{tx - half(yb):.1f},{yb:.1f} '
                     f'M{tx - half(yb):.1f},{yb:.1f} L{tx + half(yb):.1f},{yb:.1f}" '
                     'stroke="#222A3A" stroke-width="1.1" fill="none"/>')
    for k, py in enumerate([tt + 22, tt + 44]):
        tower.append(f'<rect x="{tx - 13}" y="{py}" width="6" height="15" rx="1" fill="#30394D"/>'
                     f'<rect x="{tx + 7}" y="{py}" width="6" height="15" rx="1" fill="#30394D"/>')
    tower.append(f'<line x1="{tx}" y1="{tt}" x2="{tx}" y2="{tt - 26}" stroke="#2A3346" stroke-width="2"/>')
    tower.append(f'<circle cx="{tx}" cy="{tt - 28}" r="9" fill="{TAIL}" fill-opacity=".35" filter="url(#blur6)"/>'
                 f'<circle cx="{tx}" cy="{tt - 28}" r="2.6" fill="#FF8A78"/>')
    arcs = []
    cy0 = tt + 6
    for k, (r, a) in enumerate([(42, .7), (74, .46), (108, .26), (144, .12), (182, .05)]):
        for side in (-1, 1):
            a0, a1 = math.radians(-28), math.radians(28)
            sx, sy = tx + side * r * math.cos(a0), cy0 + r * math.sin(a0)
            ex, ey = tx + side * r * math.cos(a1), cy0 + r * math.sin(a1)
            sweep = 1 if side == 1 else 0
            arcs.append(f'<path d="M{sx:.1f},{sy:.1f} A{r},{r} 0 0 {sweep} {ex:.1f},{ey:.1f}" '
                        f'stroke="{CYAN}" stroke-opacity="{a}" stroke-width="{3.2 - k * .35:.2f}" '
                        'stroke-linecap="round" fill="none"/>')
    tower.append(f'<g filter="url(#blur6)" opacity=".8">{"".join(arcs)}</g><g>{"".join(arcs)}</g>')
    body.append("<g>" + "".join(tower) + "</g>")

    # ── ground and road ─────────────────────────────────────────────────────
    body.append(f'<rect y="{HOR + 2}" width="{W}" height="{H - HOR}" fill="url(#ground)"/>')
    body.append(f'<polygon points="{quad(-15.5, 15.5, 0, Z_NEAR, Z_FAR)}" fill="url(#asphalt)"/>')
    # the median barrier: its top, and the face the camera can see
    body.append(f'<polygon points="{pts(P(0.3, 0, Z_NEAR), P(0.3, 0.9, Z_NEAR), P(0.3, 0.9, Z_FAR), P(0.3, 0, Z_FAR))}" fill="#161B26"/>')
    body.append(f'<polygon points="{quad(-0.3, 0.3, 0.9, Z_NEAR, Z_FAR)}" fill="#252D3D"/>')

    marks = []
    fade = lambda z: max(0.0, min(1.0, 1.25 - math.log10(z) / 2.3))
    for x, col, a in [(1.5, GOLD, .75), (-1.5, GOLD, .55), (12.0, "#DCE3EE", .4), (-12.0, "#DCE3EE", .3)]:
        marks.append(f'<polygon points="{quad(x - .09, x + .09, 0, Z_NEAR, 900)}" fill="{col}" fill-opacity="{a}"/>')
    for x in (5.0, 8.5, -5.0, -8.5):
        z = 8.0
        while z < 420:
            a = 0.62 * fade(z) * (0.75 if x < 0 else 1)
            marks.append(f'<polygon points="{quad(x - .08, x + .08, 0, z, z + 3)}" fill="#E4EAF3" fill-opacity="{a:.2f}"/>')
            z += 12
    studs = []
    for x in (1.7, -1.7, 11.8):
        z = 9.0
        while z < 380:
            sx, sy = P(x, 0.02, z)
            r = max(0.5, 60 / z)
            studs.append(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="{r:.2f}" fill="{CYAN}" fill-opacity="{0.85 * fade(z):.2f}"/>')
            z += 18
    body.append("<g>" + "".join(marks) + "</g>")
    body.append(f'<g filter="url(#blur2)">{"".join(studs)}</g><g>{"".join(studs)}</g>')

    # ── streetlights on the median, each with a pool of light ───────────────
    pools, poles, lamps = [], [], []
    z = 24.0
    while z < 900:
        for side in (-1, 1):
            cx, cy = P(side * 3.6, 0, z)
            ry = F * CAM_H * (1 / max(z - 6, 1) - 1 / (z + 6)) / 2
            rx = F * 5.2 / z
            k = 0.55 if side < 0 else 1.0
            pools.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="url(#pool)" opacity="{k * fade(z) + .15:.2f}"/>')
        bx, by = P(0, 0.9, z)
        tx_, ty_ = P(0, 10.6, z)
        w = max(0.6, F * 0.2 / z)
        poles.append(f'<line x1="{bx:.1f}" y1="{by:.1f}" x2="{tx_:.1f}" y2="{ty_:.1f}" stroke="#1E2533" stroke-width="{w:.2f}"/>')
        for side in (-1, 1):
            ax, ay = P(side * 1.9, 11.0, z)
            poles.append(f'<line x1="{tx_:.1f}" y1="{ty_:.1f}" x2="{ax:.1f}" y2="{ay:.1f}" stroke="#1E2533" stroke-width="{w * .8:.2f}"/>')
            k = 0.7 if side < 0 else 1.0
            lamps.append(f'<circle cx="{ax:.1f}" cy="{ay:.1f}" r="{F * 2.0 / z + 2:.1f}" fill="url(#lamp)" opacity="{k * .28:.2f}"/>'
                         f'<circle cx="{ax:.1f}" cy="{ay:.1f}" r="{F * 0.45 / z + 1.5:.1f}" fill="url(#lamp)" opacity="{k:.2f}"/>')
        z += 30
    body.append(f'<g style="mix-blend-mode:screen">{"".join(pools)}</g>')
    body.append("<g>" + "".join(poles) + "</g>")
    body.append(f'<g style="mix-blend-mode:screen">{"".join(lamps)}</g>')

    # ── light trails ───────────────────────────────────────────────────────
    cores, glows = [], []

    def trail(x: float, y: float, z0: float, z1: float, hi: str, lo: str, strength: float):
        (ax, ay), (bx, by) = P(x, y, z1), P(x, y, z0)       # far, near
        g = grad(ax, ay, bx, by, [(0, hi, 0), (.18, hi, strength), (.8, hi, strength), (1, hi, 0)])
        gl = grad(ax, ay, bx, by, [(0, lo, 0), (.2, lo, strength * .8), (.8, lo, strength * .8), (1, lo, 0)])
        cores.append(f'<polygon points="{quad(x - .06, x + .06, y, z0, z1)}" fill="{g}"/>')
        glows.append(f'<polygon points="{quad(x - .35, x + .35, y, z0, z1)}" fill="{gl}"/>')

    lanes = [(3.25, "out"), (6.75, "out"), (10.25, "out"), (-3.25, "in"), (-6.75, "in"), (-10.25, "in")]
    for x, way in lanes:
        z = rng.uniform(7.5, 16)
        while z < 700:
            length = rng.uniform(40, 260) * (1 + z / 120)
            if way == "out":
                hi, lo, y, s = "#FF9C8A", TAIL_LO, 0.75, rng.uniform(0.55, 0.9)
            else:
                hi, lo, y, s = GOLD_HI, GOLD, 0.65, rng.uniform(0.6, 0.95) * (1 if x > -8 else 0.75)
            for off in (-0.78, 0.78):
                trail(x + off, y, z, z + length, hi, lo, s)
            z += length + rng.uniform(20, 120) * (1 + z / 90)
    body.append(f'<g filter="url(#blur14)" style="mix-blend-mode:screen">{"".join(glows)}</g>')
    body.append(f'<g filter="url(#blur2)" style="mix-blend-mode:screen" opacity=".9">{"".join(cores)}</g>')
    body.append(f'<g style="mix-blend-mode:screen">{"".join(cores)}</g>')

    # ── atmosphere: horizon haze, a quiet left side, vignette, grain ────────
    body.append(f'<rect y="{HOR - 90}" width="{W}" height="170" fill="url(#haze)"/>')
    body.append(f'<rect width="{W}" height="{H}" fill="url(#calm)"/>')
    body.append(f'<rect width="{W}" height="{H}" fill="url(#vignette)"/>')
    body.append(f'<rect width="{W}" height="{H}" filter="url(#grain)" opacity=".22" style="mix-blend-mode:overlay"/>')

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">\n'
        "<!-- RoadAssist Bharat hero backdrop: an original illustration drawn for the project\n"
        "     by pages/hero/build-hero.py (edit the script, not this file). Not a photograph. -->\n"
        f"<defs>{''.join(defs)}</defs>\n" + "\n".join(body) + "\n</svg>\n"
    )


def find_chrome() -> str:
    import os
    for p in [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        "/usr/bin/google-chrome", "/usr/bin/chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]:
        if Path(p).exists():
            return p
    found = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chrome")
    if not found:
        sys.exit("build-hero: Chrome not found")
    return found


def render(svg: Path, scale: int = 2) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "hero.png"
        subprocess.run([
            find_chrome(), "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--force-color-profile=srgb", f"--force-device-scale-factor={scale}",
            f"--window-size={W},{H}", f"--user-data-dir={Path(tmp) / 'profile'}",
            f"--screenshot={png}", svg.as_uri(),
        ], check=True, capture_output=True)
        im = Image.open(png).convert("RGB")
        im.load()
    if im.size != (W * scale, H * scale):
        sys.exit(f"build-hero: Chrome rendered {im.size}, expected {(W * scale, H * scale)}")
    return im


def main() -> None:
    SVG.write_text(build(), encoding="utf-8", newline="\n")
    print(f"  {SVG.relative_to(ROOT)}  {SVG.stat().st_size // 1024} KB")
    big = render(SVG)
    for path, w, h, q in OUTPUTS:
        path.parent.mkdir(parents=True, exist_ok=True)
        big.resize((w, h), Image.LANCZOS).save(path, "WEBP", quality=q, method=6)
        print(f"  {path.relative_to(ROOT)}  {w}x{h}  {path.stat().st_size // 1024} KB")
    if "--og" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--og") + 1])
        # 1200x630: the full width, cropped around the horizon.
        card = big.resize((1200, 800), Image.LANCZOS).crop((0, 115, 1200, 745))
        card.save(out, "JPEG", quality=88, optimize=True, progressive=True)
        print(f"  {out}  1200x630  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
