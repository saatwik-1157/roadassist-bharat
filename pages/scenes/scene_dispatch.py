"""
Stage 05 - Dispatch, ranked.

The real 05-dispatch screen in a tilted device, beside an isometric map plane:
the customer pin at the centre with range rings for the 10 / 25 / 50 km search
radii the screen offers, and a handful of mechanic pins from the live pool, each
tied to the customer by a line whose brightness is its rank (the top-ranked
provider in gold, the rest in fading blue).

    python pages/scenes/scene_dispatch.py
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import *  # noqa: E402,F401,F403
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

SS = 2  # supersampling for the vector overlay


def plane_mapper(quad):
    """Map plane coords (u, v) in [-1, 1]^2 onto the screen quad (TL, TR, BR, BL)."""
    unit = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    a, b, c, d, e, f, g, h = perspective_coeffs(quad, unit)

    def to_screen(u, v):
        den = g * u + h * v + 1
        return ((a * u + b * v + c) / den, (d * u + e * v + f) / den)
    return to_screen


def phone_image(shot, height, lean=0.15):
    ph = tilt(device_frame(SHOTS / shot, screen_w=780, pad=28, radius=66), lean=lean)
    ph = ph.crop(ph.getbbox())
    ph = drop(ph, blur=30, alpha=170, offset=(18, 26))
    return ph.resize((int(ph.width * height / ph.height), height), Image.LANCZOS)


def render():
    bg = glow((W, H), [
        (W * 0.66, H * 0.62, W * 0.40, (24, 66, 158), 0.50),
        (W * 0.24, H * 0.40, W * 0.26, (10, 92, 116), 0.30),
        (W * 0.80, H * 0.14, W * 0.20, (60, 48, 22), 0.16),
    ], base=PAGE_BG).convert("RGBA")

    # ── map plane ────────────────────────────────────────────────────────────
    quad = [(700 * SS, 170 * SS), (1640 * SS, 170 * SS),
            (1990 * SS, 1130 * SS), (320 * SS, 1130 * SS)]
    P = plane_mapper(quad)
    S = lambda u, v: P(u, v)  # noqa: E731

    fx = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)

    # Plane slab: a faint filled surface with an edge light.
    corners = [S(-1, -1), S(1, -1), S(1, 1), S(-1, 1)]
    d.polygon(corners, fill=(16, 26, 48, 120))
    # Grid.
    n = 22
    for i in range(n + 1):
        t = -1 + 2 * i / n
        d.line([S(t, -1), S(t, 1)], fill=BLUE + (34,), width=2 * SS // 2 + 1)
        d.line([S(-1, t), S(1, t)], fill=BLUE + (34,), width=2 * SS // 2 + 1)

    # Roads: smooth polylines on the plane.
    def curve(fn, steps=60):
        return [S(*fn(k / steps)) for k in range(steps + 1)]
    roads = [
        curve(lambda t: (-1 + 2 * t, 0.10 + 0.22 * math.sin(t * 3.4))),
        curve(lambda t: (-0.12 + 0.18 * math.sin(t * 2.6), -1 + 2 * t)),
        curve(lambda t: (-1 + 1.6 * t, -0.95 + 1.9 * t ** 1.3)),
        curve(lambda t: (0.2 + 0.8 * t, -0.9 + 0.6 * t + 0.25 * math.sin(t * 5))),
        curve(lambda t: (-0.9 + 1.2 * t, 0.85 - 0.2 * t)),
    ]
    for r, wd in zip(roads, (9, 9, 6, 6, 5)):
        d.line(r, fill=(58, 72, 98, 150), width=wd * SS, joint="curve")
        d.line(r, fill=(120, 140, 172, 70), width=max(1, SS), joint="curve")

    # Range rings - the 10 / 25 / 50 km radii the screen lets the driver pick.
    cu, cv = -0.06, 0.12
    for rad, a in ((0.20, 120), (0.46, 90), (0.86, 60)):
        ring = [S(cu + rad * math.cos(k * math.tau / 120), cv + rad * math.sin(k * math.tau / 120))
                for k in range(121)]
        d.line(ring, fill=CYAN + (a,), width=2 * SS)

    # Fade the plane out towards its edges so it melts into the page.
    cx0, cy0 = S(-0.06, 0.12)
    fade = Image.new("L", fx.size, 0)
    ImageDraw.Draw(fade).ellipse([cx0 - 700 * SS, cy0 - 340 * SS, cx0 + 700 * SS, cy0 + 380 * SS],
                                 fill=255)
    fade = fade.filter(ImageFilter.GaussianBlur(120 * SS))
    a = fx.split()[3]
    fx.putalpha(Image.composite(a, Image.new("L", fx.size, 0), fade))
    d = ImageDraw.Draw(fx)

    # Mechanic pool: (u, v, rank). Rank 1 is the provider the screen offers.
    mechs = [(0.26, -0.24, 1), (-0.46, -0.28, 2), (0.42, 0.40, 3),
             (-0.58, 0.50, 4), (0.36, -0.74, 5)]
    rank_col = {1: GOLD}
    links = Image.new("RGBA", fx.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(links)
    for u, v, rk in sorted(mechs, key=lambda m: -m[2]):
        col = rank_col.get(rk, BLUE if rk <= 3 else (70, 110, 190))
        a = {1: 255, 2: 190, 3: 150, 4: 110, 5: 80}[rk]
        seg = [S(cu + (u - cu) * k / 30, cv + (v - cv) * k / 30) for k in range(31)]
        wd = (7 if rk == 1 else 4) * SS
        ld.line(seg, fill=col + (a,), width=wd * 3)
        d.line(seg, fill=col + (a,), width=wd)
    fx = Image.alpha_composite(links.filter(ImageFilter.GaussianBlur(9 * SS)), fx)
    d = ImageDraw.Draw(fx)

    # Pins stand up off the plane: stem, contact ellipse, head.
    def pin(u, v, col, head, stem, core=(255, 255, 255)):
        x, y = S(u, v)
        d.ellipse([x - head * 1.3, y - head * 0.45, x + head * 1.3, y + head * 0.45],
                  fill=col + (70,))
        d.line([x, y, x, y - stem], fill=col + (230,), width=3 * SS)
        hy = y - stem
        d.ellipse([x - head, hy - head, x + head, hy + head], fill=col + (255,))
        d.ellipse([x - head * 0.42, hy - head * 0.42, x + head * 0.42, hy + head * 0.42],
                  fill=core + (255,))
        return x, hy

    heads = []
    for u, v, rk in sorted(mechs, key=lambda m: m[1]):
        col = GOLD if rk == 1 else (BLUE if rk <= 3 else (80, 118, 196))
        size = (16 if rk == 1 else 11) * SS
        heads.append((pin(u, v, col, size, (74 if rk == 1 else 52) * SS, (20, 16, 10)), rk))
    # Customer at the centre: a red pin with a pulse.
    x, y = S(cu, cv)
    for r, a in ((46, 40), (30, 80)):
        d.ellipse([x - r * SS * 1.6, y - r * SS * 0.6, x + r * SS * 1.6, y + r * SS * 0.6],
                  outline=RED + (a,), width=2 * SS)
    pin(cu, cv, RED, 17 * SS, 86 * SS)

    # Soft halo behind the top-ranked head.
    halo = Image.new("RGBA", fx.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    for (hx, hy), rk in heads:
        if rk == 1:
            hd.ellipse([hx - 60 * SS, hy - 60 * SS, hx + 60 * SS, hy + 60 * SS], fill=GOLD + (110,))
            d.ellipse([hx - 30 * SS, hy - 30 * SS, hx + 30 * SS, hy + 30 * SS],
                      outline=GOLD + (120,), width=2 * SS)
    x, y = S(cu, cv)
    hd.ellipse([x - 56 * SS, y - 142 * SS, x + 56 * SS, y - 30 * SS], fill=RED + (80,))
    fx = Image.alpha_composite(halo.filter(ImageFilter.GaussianBlur(22 * SS)), fx)

    bg.alpha_composite(fx.resize((W, H), Image.LANCZOS))

    # ── the real screen ──────────────────────────────────────────────────────
    phone = phone_image("05-dispatch.png", 930)
    bg.alpha_composite(phone, (40, (H - phone.height) // 2 + 6))

    save(bg, "05-dispatch")


if __name__ == "__main__":
    render()
