"""
Hero image for the public page: the whole platform in one 3D scene.

A desktop monitor at the back runs the real RAKSHA authority dashboard, a large
phone in front runs the real citizen home screen, and a smaller phone runs the
real dispatch screen. They stand on a glowing perspective ground and are joined
by luminous arcs: one process linking three surfaces. Every screen is a real
screenshot of the running app; everything else is procedural Pillow geometry.

    python pages/scenes/hero_3d.py
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import *  # noqa: E402,F401,F403
from _common import OUT  # noqa: E402

W, H = 1600, 1200
HORIZON = int(H * 0.60)


# ── helpers ──────────────────────────────────────────────────────────────────
def warp(img, quad):
    """Place an RGBA image onto the canvas so its corners land on quad (TL,TR,BR,BL)."""
    w, h = img.size
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    coeffs = perspective_coeffs(src, quad)
    return img.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)


def solid(layer, col):
    """An opaque silhouette of a layer in one colour."""
    s = Image.new("RGBA", layer.size, col + (255,))
    s.putalpha(layer.split()[3])
    return s


def extrude(canvas, layer, dx, dy, steps, col):
    """Give a flat warped panel thickness by stacking its silhouette behind it."""
    sil = solid(layer, col)
    for i in range(steps, 0, -1):
        t = i / steps
        canvas.alpha_composite(ImageChops.offset(sil, int(round(dx * t)), int(round(dy * t))))


def radial(size, cx, cy, rx, ry, blur):
    """A soft elliptical L-mask (255 in the middle, 0 outside)."""
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur))


def scale_alpha(layer, mask):
    r, g, b, a = layer.split()
    return Image.merge("RGBA", (r, g, b, ImageChops.multiply(a, mask)))


def shadow(canvas, cx, cy, rx, ry, alpha=200, blur=26):
    s = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(s).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(0, 0, 0, alpha))
    canvas.alpha_composite(s.filter(ImageFilter.GaussianBlur(blur)))


def light_pool(canvas, cx, cy, rx, ry, col, alpha, blur=60):
    s = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(s).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=col + (alpha,))
    canvas.alpha_composite(s.filter(ImageFilter.GaussianBlur(blur)))


def bezier(p0, p1, p2, n=80):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    return pts


def reflection(layer, base_y, strength=70, depth=260):
    """A faint mirror of a layer in the floor, fading away below base_y."""
    box = layer.getbbox()
    if not box:
        return Image.new("RGBA", (W, H), (0, 0, 0, 0))
    part = layer.crop((box[0], box[1], box[2], base_y)).transpose(Image.FLIP_TOP_BOTTOM)
    fade = Image.new("L", part.size, 0)
    fd = ImageDraw.Draw(fade)
    for y in range(min(depth, part.height)):
        fd.line([0, y, part.width, y], fill=int(strength * (1 - y / depth) ** 2))
    part = scale_alpha(part, fade).filter(ImageFilter.GaussianBlur(3))
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.alpha_composite(part, (box[0], base_y))
    return out


# ── pieces ───────────────────────────────────────────────────────────────────
def background():
    bg = glow((W, H), [
        (W * 0.50, H * 0.50, W * 0.40, (22, 62, 150), 0.60),
        (W * 0.20, H * 0.30, W * 0.24, (10, 92, 116), 0.45),
        (W * 0.80, H * 0.78, W * 0.22, (120, 86, 30), 0.30),
    ], base=PAGE_BG).convert("RGBA")

    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(grid)
    vx = W * 0.5
    for i in range(-16, 17):
        d.line([vx + i * 16, HORIZON, vx + i * W * 0.11, H + 200], fill=BLUE + (70,), width=2)
    for i in range(1, 16):
        t = i / 15
        y = HORIZON + (H - HORIZON + 60) * (t ** 2.0)
        d.line([0, y, W, y], fill=BLUE + (int(30 + 60 * t),), width=2)
    # Horizon glow line.
    d.line([W * 0.05, HORIZON, W * 0.95, HORIZON], fill=CYAN + (90,), width=2)
    grid = scale_alpha(grid, radial((W, H), W * 0.5, H * 0.80, W * 0.46, H * 0.30, 90))
    bg.alpha_composite(grid)
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(halo).rectangle([W * 0.12, HORIZON - 6, W * 0.88, HORIZON + 6],
                                   fill=CYAN + (70,))
    bg.alpha_composite(halo.filter(ImageFilter.GaussianBlur(22)))
    return bg


def monitor_panel():
    """Flat monitor face: the real dashboard in a thin bezel."""
    shot = Image.open(SHOTS / "14-authority.png").convert("RGB")
    sw = 1280
    sh = int(sw * shot.height / shot.width)
    shot = shot.resize((sw, sh), Image.LANCZOS).convert("RGBA")
    shot.putalpha(rounded_mask((sw, sh), 10))
    pad = 26
    bw, bh = sw + pad * 2, sh + pad * 2 + 30
    body = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=26, fill=(14, 18, 27, 255))
    bd.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=26, outline=(76, 94, 122, 255), width=4)
    body.alpha_composite(shot, (pad, pad))
    # Chin with a small power light.
    bd.ellipse([bw // 2 - 6, bh - 34, bw // 2 + 6, bh - 22], fill=CYAN + (255,))
    return body


def render():
    img = background()

    # Monitor: back, centre-left, facing slightly right.
    mon = monitor_panel()
    mq = [(120, 150), (1010, 215), (1010, 700), (120, 770)]
    mon_l = warp(mon, mq)
    base_y = 858
    # Stand: neck and foot, drawn under the monitor.
    stand = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stand)
    nx = 560
    sd.polygon([(nx - 34, 700), (nx + 34, 696), (nx + 26, base_y - 14), (nx - 30, base_y - 12)],
               fill=(22, 28, 40, 255))
    sd.line([(nx - 34, 700), (nx - 30, base_y - 12)], fill=(80, 98, 128, 255), width=3)
    sd.ellipse([nx - 190, base_y - 34, nx + 180, base_y + 18], fill=(18, 23, 34, 255))
    sd.arc([nx - 190, base_y - 34, nx + 180, base_y + 18], 190, 350, fill=(96, 116, 150, 255), width=3)
    shadow(img, nx, base_y + 8, 260, 36, 220, 22)
    light_pool(img, 565, 800, 520, 90, BLUE, 70, 70)
    img.alpha_composite(stand)
    extrude(img, mon_l, 16, -4, 16, (26, 32, 46))
    img.alpha_composite(mon_l)
    # Screen glare: a soft diagonal sheen.
    sheen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sheen).polygon([(130, 160), (430, 185), (190, 760), (130, 765)],
                                  fill=(255, 255, 255, 14))
    img.alpha_composite(scale_alpha(sheen.filter(ImageFilter.GaussianBlur(30)),
                                    mon_l.split()[3]))

    # Luminous arcs: citizen -> dispatch -> authority, the one shared process.
    # Endpoints sit on the devices' edges and feet, never on their screens.
    small_top = (168, 540)
    mon_corner = (126, 175)
    mon_top = (600, 196)
    big_top = (1040, 118)
    small_foot = (440, 1086)
    big_foot = (836, 1046)
    arcs = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ad = ImageDraw.Draw(arcs)
    paths = [
        (bezier(mon_top, (820, -60), big_top), CYAN),
        (bezier(small_top, (-10, 330), mon_corner), GOLD),
        (bezier(small_foot, (640, 1190), big_foot), BLUE),
    ]
    for pts, col in paths:
        for width, a in ((16, 26), (7, 70), (3, 230)):
            ad.line(pts, fill=col + (a,), width=width, joint="curve")
    blur_arcs = arcs.filter(ImageFilter.GaussianBlur(6))
    img.alpha_composite(blur_arcs)
    img.alpha_composite(arcs)
    # Travelling pulses along the arcs.
    pulse = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(pulse)
    for pts, col in paths:
        for k in (0.5,):
            x, y = pts[int(k * (len(pts) - 1))]
            pd.ellipse([x - 22, y - 22, x + 22, y + 22], fill=col + (90,))
            pd.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(255, 255, 255, 255))
    img.alpha_composite(pulse.filter(ImageFilter.GaussianBlur(8)))
    img.alpha_composite(pulse.filter(ImageFilter.GaussianBlur(1)))

    # Small phone: front-left, dispatch.
    sp = device_frame(SHOTS / "05-dispatch.png", screen_w=620, pad=24, radius=62)
    sq = [(160, 520), (440, 548), (440, 1080), (160, 1112)]
    sp_l = warp(sp, sq)
    shadow(img, 310, 1104, 190, 24, 230, 18)
    light_pool(img, 300, 1090, 260, 60, GOLD, 60, 40)
    img.alpha_composite(reflection(sp_l, 1080, 50, 120))
    extrude(img, sp_l, 12, -2, 12, (30, 38, 54))
    img.alpha_composite(sp_l)

    # Big phone: front-right, citizen home.
    bp = device_frame(SHOTS / "02-home.png", screen_w=760)
    bq = [(830, 140), (1290, 100), (1290, 1070), (830, 1040)]
    bp_l = warp(bp, bq)
    shadow(img, 1070, 1068, 300, 34, 240, 22)
    light_pool(img, 1060, 1060, 380, 70, CYAN, 70, 46)
    img.alpha_composite(reflection(bp_l, 1050, 55, 120))
    extrude(img, bp_l, -18, 2, 16, (30, 38, 54))
    img.alpha_composite(bp_l)
    sheen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sheen).polygon([(830, 140), (1060, 120), (870, 700), (830, 700)],
                                  fill=(255, 255, 255, 16))
    img.alpha_composite(scale_alpha(sheen.filter(ImageFilter.GaussianBlur(30)),
                                    bp_l.split()[3]))

    # Endpoint nodes where the arcs meet each surface.
    nodes = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    nd = ImageDraw.Draw(nodes)
    for (x, y), col in ((big_top, CYAN), (mon_top, CYAN), (small_top, GOLD),
                        (mon_corner, GOLD), (small_foot, BLUE), (big_foot, BLUE)):
        nd.ellipse([x - 20, y - 20, x + 20, y + 20], outline=col + (140,), width=3)
        nd.ellipse([x - 8, y - 8, x + 8, y + 8], fill=col + (255,))
    img.alpha_composite(nodes.filter(ImageFilter.GaussianBlur(5)))
    img.alpha_composite(nodes)

    # Fade every edge into the page colour so the image has no visible box.
    edge = Image.new("L", (W, H), 0)
    ImageDraw.Draw(edge).rounded_rectangle([70, 40, W - 70, H - 60], radius=260, fill=255)
    edge = edge.filter(ImageFilter.GaussianBlur(70))
    page = Image.new("RGBA", (W, H), PAGE_BG + (255,))
    out = Image.composite(img, page, edge).convert("RGB")

    path = OUT / "hero.webp"
    out.save(path, "WEBP", quality=84, method=6)
    kb = path.stat().st_size // 1024
    if kb > 300:
        raise SystemExit(f"hero: {kb} KB is over the 300 KB budget")
    print(f"  scene/hero.webp  {kb} KB")
    return out


if __name__ == "__main__":
    render()
