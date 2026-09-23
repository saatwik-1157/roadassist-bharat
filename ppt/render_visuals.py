"""
Render the deck's 3D visuals.

Two kinds, and the distinction is deliberate:

  * Product visuals are built from REAL screenshots of the running application,
    set into perspective-warped device frames. In a viva that is worth more than
    any generated artwork — it is the actual system, and it can be checked.

  * Infrastructure visuals (the data centre) are rendered procedurally as
    isometric geometry. Nothing photographic is claimed, and no stock image with
    unknown licensing enters the deck.

    python ppt/render_visuals.py
"""
import math
import os
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

# The real screenshots the deck is built from. They live in the repository, so
# this script runs from a clean clone; RENDER_SHOTS overrides the location if a
# fresher capture is being rendered from somewhere else.
SHOTS = Path(os.environ.get(
    "RENDER_SHOTS", HERE.parent / "app" / "docs" / "screenshots"))

BLUE = (46, 125, 255)
CYAN = (34, 211, 238)
GOLD = (227, 185, 106)
RED = (255, 77, 94)
GREEN = (52, 211, 153)
GROUND = (5, 8, 14)


# ── helpers ──────────────────────────────────────────────────────────────────
def perspective_coeffs(src, dst):
    """Coefficients mapping dst quad -> src quad, as PIL.Image.PERSPECTIVE wants."""
    matrix = []
    for (sx, sy), (dx, dy) in zip(src, dst):
        matrix.append([dx, dy, 1, 0, 0, 0, -sx * dx, -sx * dy])
        matrix.append([0, 0, 0, dx, dy, 1, -sy * dx, -sy * dy])
    # Solve the 8x8 system by Gaussian elimination — no numpy dependency.
    A = [row[:] for row in matrix]
    b = [src[i // 2][i % 2] for i in range(8)]
    n = 8
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(A[r][col]))
        A[col], A[piv] = A[piv], A[col]
        b[col], b[piv] = b[piv], b[col]
        pv = A[col][col]
        if abs(pv) < 1e-12:
            continue
        for r in range(n):
            if r == col:
                continue
            f = A[r][col] / pv
            for c in range(col, n):
                A[r][c] -= f * A[col][c]
            b[r] -= f * b[col]
    return [b[i] / A[i][i] if abs(A[i][i]) > 1e-12 else 0.0 for i in range(n)]


def glow(size, blobs, base=GROUND):
    img = Image.new("RGB", size, base)
    layer = Image.new("RGB", size, (0, 0, 0))
    d = ImageDraw.Draw(layer)
    for cx, cy, r, col, strength in blobs:
        d.ellipse([cx - r, cy - r, cx + r, cy + r],
                  fill=tuple(int(c * strength) for c in col))
    return ImageChops.add(img, layer.filter(ImageFilter.GaussianBlur(size[0] // 9)))


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1],
                                        radius=radius, fill=255)
    return m


def device_frame(shot_path, screen_w=760, pad=26, radius=62):
    """A phone body around a real screenshot, on transparency."""
    shot = Image.open(shot_path).convert("RGB")
    ratio = shot.height / shot.width
    sw, sh = screen_w, int(screen_w * ratio)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    shot.putalpha(rounded_mask((sw, sh), radius - 10))

    bw, bh = sw + pad * 2, sh + pad * 2
    body = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    # Bezel with a faint edge light so the device reads as a solid object.
    bd.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=radius, fill=(14, 18, 27, 255))
    bd.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=radius,
                         outline=(70, 86, 112, 255), width=3)
    bd.rounded_rectangle([2, 2, bw - 3, bh - 3], radius=radius - 2,
                         outline=(24, 32, 46, 255), width=2)
    body.alpha_composite(shot, (pad, pad))
    return body


def tilt(img, lean=0.16, squeeze=0.05, scale=1.0):
    """Perspective-warp an RGBA image so it recedes to the right."""
    w, h = img.size
    pad_x, pad_y = int(w * 0.35), int(h * 0.22)
    canvas = Image.new("RGBA", (w + pad_x * 2, h + pad_y * 2), (0, 0, 0, 0))
    canvas.alpha_composite(img, (pad_x, pad_y))
    W, H = canvas.size
    src = [(0, 0), (W, 0), (W, H), (0, H)]
    dy = H * lean
    dx = W * squeeze
    dst = [(0, dy * 0.55), (W - dx, 0), (W - dx, H), (0, H - dy * 0.55)]
    coeffs = perspective_coeffs(src, dst)
    out = canvas.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    if scale != 1.0:
        out = out.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
    return out


def drop(img, blur=34, alpha=150, offset=(16, 26)):
    """A soft contact shadow behind an RGBA object."""
    a = img.split()[3].filter(ImageFilter.GaussianBlur(blur))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: int(v * alpha / 255)))
    canvas = Image.new("RGBA", (img.width + offset[0] * 2, img.height + offset[1] * 2),
                       (0, 0, 0, 0))
    canvas.alpha_composite(sh, (offset[0] * 2, offset[1] * 2))
    canvas.alpha_composite(img, (offset[0], offset[1]))
    return canvas


def net_lines(draw, w, h, nodes, col=BLUE, alpha_line=54):
    for i, (x1, y1) in enumerate(nodes):
        for x2, y2 in nodes[i + 1:]:
            if math.dist((x1, y1), (x2, y2)) < w * 0.34:
                draw.line([x1, y1, x2, y2], fill=col + (alpha_line,), width=2)
    for x, y in nodes:
        draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill=col + (210,))
        draw.ellipse([x - 12, y - 12, x + 12, y + 12], outline=col + (70,), width=2)


# ── 1. HERO — real app in a tilted device over a network field ───────────────
def hero():
    W, H = 1720, 1680
    bg = glow((W, H), [
        (W * 0.62, H * 0.60, W * 0.52, (24, 66, 158), 0.55),
        (W * 0.30, H * 0.26, W * 0.34, (10, 92, 116), 0.34),
        (W * 0.80, H * 0.92, W * 0.30, (60, 20, 44), 0.20),
    ]).convert("RGBA")

    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)
    # A ground grid in perspective — the "connected road" read.
    for i in range(-8, 22):
        x = W * 0.5 + i * W * 0.085
        d.line([W * 0.5, H * 0.60, x, H], fill=BLUE + (26,), width=2)
    for i in range(1, 12):
        t = i / 11
        y = H * 0.60 + (H * 0.40) * (t ** 2.1)
        d.line([0, y, W, y], fill=BLUE + (int(30 * t) + 8,), width=2)
    net_lines(d, W, H, [
        (int(W * 0.10), int(H * 0.16)), (int(W * 0.27), int(H * 0.09)),
        (int(W * 0.16), int(H * 0.35)), (int(W * 0.36), int(H * 0.27)),
        (int(W * 0.86), int(H * 0.20)), (int(W * 0.75), int(H * 0.34)),
        (int(W * 0.92), int(H * 0.42)),
    ], CYAN, 46)
    bg.alpha_composite(fx)

    phone = drop(tilt(device_frame(SHOTS / "02-home.png", screen_w=690), lean=0.15))
    ph = int(H * 0.96)
    phone = phone.resize((int(phone.width * ph / phone.height), ph), Image.LANCZOS)
    px, py = int(W * 0.26), int(H * 0.02)
    bg.alpha_composite(phone, (px, py))

    # Secondary device, further back, showing the other side of the product.
    mech = drop(tilt(device_frame(SHOTS / "13-mechanic-login.png", screen_w=520),
                     lean=0.13), blur=26, alpha=120)
    mh = int(H * 0.64)
    mech = mech.resize((int(mech.width * mh / mech.height), mh), Image.LANCZOS)
    mech = Image.blend(Image.new("RGBA", mech.size, (0, 0, 0, 0)), mech, 0.82)
    bg.alpha_composite(mech, (int(W * -0.06), int(H * 0.34)))

    bg.convert("RGB").save(ASSETS / "vis_hero.png", "PNG", optimize=True)
    print("  vis_hero.png")


# ── 2. DATA CENTRE — procedural isometric racks ──────────────────────────────
def datacenter():
    W, H = 1800, 1080
    img = glow((W, H), [
        (W * 0.50, H * 0.52, W * 0.42, (18, 52, 128), 0.26),
        (W * 0.18, H * 0.86, W * 0.24, (10, 86, 108), 0.14),
        (W * 0.84, H * 0.80, W * 0.24, (10, 86, 108), 0.12),
    ]).convert("RGBA")
    d = ImageDraw.Draw(img, "RGBA")

    # Floor grid, receding.
    for i in range(0, 26):
        t = i / 25
        y = H * 0.56 + (H * 0.46) * (t ** 1.9)
        d.line([0, y, W, y], fill=BLUE + (int(16 * t) + 4,), width=2)
    for i in range(-14, 15):
        d.line([W * 0.5 + i * W * 0.05, H * 0.56, W * 0.5 + i * W * 0.30, H],
               fill=BLUE + (11,), width=2)

    def rack(cx, base_y, w, h, depth, tone, lit, leds=12):
        """One isometric cabinet: front face, right face, top face."""
        fx0, fx1 = cx - w / 2, cx + w / 2
        fy0, fy1 = base_y - h, base_y
        dxp, dyp = depth * 0.62, -depth * 0.42
        # right face
        d.polygon([(fx1, fy0), (fx1 + dxp, fy0 + dyp), (fx1 + dxp, fy1 + dyp), (fx1, fy1)],
                  fill=(tone[0] - 6, tone[1] - 5, tone[2] - 4, 255))
        # top face
        d.polygon([(fx0, fy0), (fx1, fy0), (fx1 + dxp, fy0 + dyp), (fx0 + dxp, fy0 + dyp)],
                  fill=(tone[0] + 10, tone[1] + 11, tone[2] + 14, 255))
        # front face
        d.polygon([(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1)], fill=tone + (255,))
        d.line([(fx0, fy0), (fx0, fy1)], fill=(70, 92, 126, 255), width=2)
        d.line([(fx0, fy0), (fx1, fy0)], fill=(70, 92, 126, 255), width=2)
        # server blades + status LEDs
        step = h / leds
        for k in range(leds):
            by = fy0 + k * step + step * 0.22
            d.rectangle([fx0 + 5, by, fx1 - 5, by + step * 0.52],
                        fill=(tone[0] + 5, tone[1] + 6, tone[2] + 9, 255))
            if (k * 7 + int(cx)) % 3 != 0:
                c = lit if (k % 4) else CYAN
                d.rectangle([fx0 + 9, by + step * 0.14, fx0 + 17, by + step * 0.36],
                            fill=c + (255,))
                d.rectangle([fx1 - 22, by + step * 0.14, fx1 - 14, by + step * 0.36],
                            fill=(c[0], c[1], c[2], 150))

    rows = [
        (0.70, 210, 340, 52, (13, 18, 28), BLUE),    # far
        (0.80, 250, 400, 62, (16, 22, 33), CYAN),    # mid
        (0.92, 300, 470, 74, (20, 27, 40), GREEN),   # near
    ]
    for depth_t, w, h, dep, tone, lit in rows:
        base_y = H * depth_t
        n = 5 if w > 280 else 7
        span = W * (0.90 if w > 280 else 0.98)
        for i in range(n):
            cx = W * 0.5 + (i - (n - 1) / 2) * (span / n)
            rack(cx, base_y, w * 0.62, h, dep, tone, lit)

    # Cold-aisle light between the front rows.
    aisle = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ad = ImageDraw.Draw(aisle)
    ad.polygon([(W * 0.34, H * 0.70), (W * 0.66, H * 0.70),
                (W * 0.80, H), (W * 0.20, H)], fill=CYAN + (16,))
    img.alpha_composite(aisle.filter(ImageFilter.GaussianBlur(80)))

    # Trim the empty sky so the hall fills the frame it is placed in.
    img = img.crop((0, int(H * 0.20), W, H))
    img.convert("RGB").save(ASSETS / "vis_datacenter.png", "PNG", optimize=True)
    print("  vis_datacenter.png")


# ── 3. CLOSING — tracking screen, route field ────────────────────────────────
def closing():
    W, H = 1180, 1520
    bg = glow((W, H), [
        (W * 0.52, H * 0.58, W * 0.62, (22, 62, 150), 0.50),
        (W * 0.20, H * 0.18, W * 0.34, (10, 92, 116), 0.28),
        (W * 0.80, H * 0.90, W * 0.30, (78, 22, 44), 0.22),
    ]).convert("RGBA")
    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)
    # A glowing route, drawn as a smooth curve between two markers.
    pts = [(W * 0.10, H * 0.90), (W * 0.28, H * 0.74), (W * 0.34, H * 0.55),
           (W * 0.52, H * 0.40), (W * 0.74, H * 0.30), (W * 0.90, H * 0.16)]
    for width, a in ((22, 34), (12, 70), (5, 210)):
        d.line(pts, fill=CYAN + (a,), width=width, joint="curve")
    for (x, y), col in ((pts[0], GREEN), (pts[-1], RED)):
        d.ellipse([x - 26, y - 26, x + 26, y + 26], outline=col + (110,), width=3)
        d.ellipse([x - 11, y - 11, x + 11, y + 11], fill=col + (255,))
    net_lines(d, W, H, [(int(W * 0.14), int(H * 0.20)), (int(W * 0.34), int(H * 0.12)),
                        (int(W * 0.86), int(H * 0.62)), (int(W * 0.70), int(H * 0.74))],
              BLUE, 44)
    bg.alpha_composite(fx.filter(ImageFilter.GaussianBlur(1)))

    phone = drop(tilt(device_frame(SHOTS / "06-tracking.png", screen_w=660), lean=0.14))
    ph = int(H * 0.99)
    phone = phone.resize((int(phone.width * ph / phone.height), ph), Image.LANCZOS)
    bg.alpha_composite(phone, (int(W * 0.05), int(H * 0.005)))
    bg.convert("RGB").save(ASSETS / "vis_closing.png", "PNG", optimize=True)
    print("  vis_closing.png")


# ── 4. PRODUCT STRIP — three real surfaces, for the vision slide ─────────────
def product_strip():
    W, H = 1900, 900
    bg = glow((W, H), [(W * 0.5, H * 0.5, W * 0.44, (18, 52, 122), 0.40)]).convert("RGBA")
    picks = [("02-home.png", 0.055, 0.86), ("06-tracking.png", 0.375, 0.96),
             ("13-mechanic-login.png", 0.70, 0.86)]
    for name, x_t, scale_t in picks:
        dev = drop(tilt(device_frame(SHOTS / name, screen_w=520), lean=0.12),
                   blur=26, alpha=130)
        hh = int(H * scale_t)
        dev = dev.resize((int(dev.width * hh / dev.height), hh), Image.LANCZOS)
        bg.alpha_composite(dev, (int(W * x_t), int(H * (1 - scale_t) * 0.5)))
    bg.convert("RGB").save(ASSETS / "vis_products.png", "PNG", optimize=True)
    print("  vis_products.png")


if __name__ == "__main__":
    missing = [p for p in ("02-home.png", "06-tracking.png", "13-mechanic-login.png")
               if not (SHOTS / p).exists()]
    if missing:
        raise SystemExit(f"Screenshots missing from {SHOTS}: {missing}")
    print("rendering:")
    hero()
    datacenter()
    closing()
    product_strip()
    print("done ->", ASSETS)
