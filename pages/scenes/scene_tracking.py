"""
Stage 06 - Live status.

The real 06-tracking screen in a tilted device, in front of a perspective ground
plane that carries a glowing route from the mechanic's marker to the customer.
A side rail shows the booking state machine the live event stream drives: the
current state (ASSIGNED, as on the captured screen) lit, the states still to
come dim.

    python pages/scenes/scene_tracking.py
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import *  # noqa: E402,F401,F403
from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

SS = 2  # supersampling for the vector overlay
STATES = ("ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED")
CURRENT = 0  # the captured screen shows the booking in ASSIGNED


def plane_mapper(quad):
    """Map plane coords (u, v) in [-1, 1]^2 onto the screen quad (TL, TR, BR, BL)."""
    unit = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    a, b, c, d, e, f, g, h = perspective_coeffs(quad, unit)

    def to_screen(u, v):
        den = g * u + h * v + 1
        return ((a * u + b * v + c) / den, (d * u + e * v + f) / den)
    return to_screen


def phone_image(shot, height, lean=0.15):
    """The device receding to the LEFT: tilt a mirrored frame, then mirror back."""
    frame = device_frame(SHOTS / shot, screen_w=780, pad=28, radius=66)
    ph = tilt(frame.transpose(Image.FLIP_LEFT_RIGHT), lean=lean)
    ph = ph.transpose(Image.FLIP_LEFT_RIGHT)
    ph = ph.crop(ph.getbbox())
    ph = drop(ph, blur=30, alpha=170, offset=(18, 26))
    return ph.resize((int(ph.width * height / ph.height), height), Image.LANCZOS)


def render():
    bg = glow((W, H), [
        (W * 0.40, H * 0.62, W * 0.40, (24, 66, 158), 0.50),
        (W * 0.76, H * 0.40, W * 0.26, (10, 92, 116), 0.30),
        (W * 0.14, H * 0.20, W * 0.18, (60, 48, 22), 0.16),
    ], base=PAGE_BG).convert("RGBA")

    # ── ground plane ─────────────────────────────────────────────────────────
    quad = [(-60 * SS, 200 * SS), (1180 * SS, 200 * SS),
            (1500 * SS, 1160 * SS), (-420 * SS, 1160 * SS)]
    S = plane_mapper(quad)

    fx = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)
    d.polygon([S(-1, -1), S(1, -1), S(1, 1), S(-1, 1)], fill=(16, 26, 48, 120))
    n = 22
    for i in range(n + 1):
        t = -1 + 2 * i / n
        d.line([S(t, -1), S(t, 1)], fill=BLUE + (34,), width=SS + 1)
        d.line([S(-1, t), S(1, t)], fill=BLUE + (34,), width=SS + 1)

    # A few side streets, dim, for the map read.
    def curve(fn, steps=80):
        return [S(*fn(k / steps)) for k in range(steps + 1)]
    for fn, wd in (
        (lambda t: (-1 + 2 * t, -0.35 + 0.12 * math.sin(t * 4)), 7),
        (lambda t: (-0.55 + 0.1 * math.sin(t * 3), -1 + 2 * t), 7),
        (lambda t: (0.45 + 0.08 * math.sin(t * 5), -1 + 2 * t), 5),
        (lambda t: (-1 + 2 * t, 0.62 - 0.1 * t), 5),
    ):
        r = curve(fn)
        d.line(r, fill=(58, 72, 98, 140), width=wd * SS, joint="curve")

    cx0, cy0 = S(0.0, 0.1)
    fade = Image.new("L", fx.size, 0)
    ImageDraw.Draw(fade).ellipse([cx0 - 720 * SS, cy0 - 360 * SS, cx0 + 720 * SS, cy0 + 380 * SS],
                                 fill=255)
    fade = fade.filter(ImageFilter.GaussianBlur(120 * SS))
    fx.putalpha(Image.composite(fx.split()[3], Image.new("L", fx.size, 0), fade))
    d = ImageDraw.Draw(fx)

    # ── the route: mechanic (far) winding to the customer (near) ─────────────
    route_uv = [(-0.16 + 0.50 * t + 0.20 * math.sin(t * 7.0) * (1 - t),
                 -0.80 + 1.42 * t + 0.06 * math.sin(t * 11)) for t in
                (k / 140 for k in range(141))]
    route = [S(u, v) for u, v in route_uv]
    rg = Image.new("RGBA", fx.size, (0, 0, 0, 0))
    ImageDraw.Draw(rg).line(route, fill=CYAN + (150,), width=30 * SS, joint="curve")
    fx = Image.alpha_composite(fx, rg.filter(ImageFilter.GaussianBlur(14 * SS)))
    d = ImageDraw.Draw(fx)
    d.line(route, fill=CYAN + (90,), width=12 * SS, joint="curve")
    d.line(route, fill=(190, 245, 255, 235), width=4 * SS, joint="curve")
    # Travel ticks along the route, so it reads as a path with direction.
    for k in range(8, len(route) - 6, 12):
        x, y = route[k]
        d.ellipse([x - 4 * SS, y - 4 * SS, x + 4 * SS, y + 4 * SS], fill=(255, 255, 255, 200))

    def marker(pt, col, head, stem, core=(255, 255, 255)):
        x, y = pt
        for r, a in ((3.2, 40), (2.2, 80)):
            d.ellipse([x - head * r, y - head * r * 0.38, x + head * r, y + head * r * 0.38],
                      outline=col + (a,), width=2 * SS)
        d.line([x, y, x, y - stem], fill=col + (230,), width=3 * SS)
        hy = y - stem
        d.ellipse([x - head, hy - head, x + head, hy + head], fill=col + (255,))
        d.ellipse([x - head * 0.42, hy - head * 0.42, x + head * 0.42, hy + head * 0.42],
                  fill=core + (255,))
        return x, hy

    mech_head = marker(route[0], GOLD, 15 * SS, 64 * SS, (20, 16, 10))
    cust_head = marker(route[-1], RED, 19 * SS, 92 * SS)

    halo = Image.new("RGBA", fx.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    for (hx, hy), col, r in ((mech_head, GOLD, 56), (cust_head, RED, 70)):
        hd.ellipse([hx - r * SS, hy - r * SS, hx + r * SS, hy + r * SS], fill=col + (100,))
    fx = Image.alpha_composite(halo.filter(ImageFilter.GaussianBlur(24 * SS)), fx)
    d = ImageDraw.Draw(fx)

    # ── state rail ───────────────────────────────────────────────────────────
    font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 19 * SS)
    rx, top, step = 96 * SS, 170 * SS, 88 * SS
    panel = Image.new("RGBA", fx.size, (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle(
        [rx - 46 * SS, top - 46 * SS, rx + 250 * SS, top + step * 3 + 46 * SS],
        radius=22 * SS, fill=(8, 11, 18, 170), outline=(70, 86, 112, 90), width=2 * SS)
    fx = Image.alpha_composite(fx, panel)
    d = ImageDraw.Draw(fx)
    d.line([rx, top, rx, top + step * (len(STATES) - 1)], fill=(80, 96, 124, 150), width=2 * SS)
    lit = Image.new("RGBA", fx.size, (0, 0, 0, 0))
    ldr = ImageDraw.Draw(lit)
    for i, name in enumerate(STATES):
        y = top + i * step
        if i < CURRENT:
            col, fill, txt = GREEN, GREEN + (255,), (210, 240, 228, 235)
        elif i == CURRENT:
            col, fill, txt = GOLD, GOLD + (255,), (240, 222, 186, 255)
            d.ellipse([rx - 22 * SS, y - 22 * SS, rx + 22 * SS, y + 22 * SS],
                      outline=GOLD + (110,), width=2 * SS)
            ldr.ellipse([rx - 30 * SS, y - 30 * SS, rx + 30 * SS, y + 30 * SS], fill=GOLD + (90,))
        else:
            col, fill, txt = (90, 104, 130), (22, 28, 40, 255), (128, 140, 162, 170)
        r = 11 * SS
        d.ellipse([rx - r, y - r, rx + r, y + r], fill=fill, outline=col + (220,), width=2 * SS)
        d.text((rx + 34 * SS, y), name, font=font, fill=txt, anchor="lm")
    fx = Image.alpha_composite(lit.filter(ImageFilter.GaussianBlur(14 * SS)), fx)

    bg.alpha_composite(fx.resize((W, H), Image.LANCZOS))

    # ── the real screen ──────────────────────────────────────────────────────
    phone = phone_image("06-tracking.png", 930)
    bg.alpha_composite(phone, (W - phone.width - 40, (H - phone.height) // 2 + 6))

    save(bg, "06-tracking")


if __name__ == "__main__":
    render()
