"""
Stage scene: Request or escalate (shot 02-home).

The real home screen in a tilted phone. Two paths leave it: a calm blue road
for an ordinary assistance request, and red pulse rings from the SOS control,
with a hold dial whose arc stands for the deliberate 1.5 second press.

    python pages/scenes/scene_home.py
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import *  # noqa: E402,F401,F403

from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

SHOT = "02-home"


def build_phone(shot, target_h, lean=0.15, squeeze=0.05, blur=30, alpha=150,
                offset=(14, 24)):
    """Tilted phone around a real screenshot, plus a map from screenshot pixels
    to pixels in the returned image (so scene geometry can line up with the UI)."""
    src_img = Image.open(SHOTS / f"{shot}.png")
    sw_native = src_img.width
    pad, radius = 26, 62
    body = device_frame(SHOTS / f"{shot}.png", screen_w=sw_native, pad=pad, radius=radius)
    bw, bh = body.size
    mx, my = int(bw * 0.35), int(bh * 0.22)
    canvas = Image.new("RGBA", (bw + mx * 2, bh + my * 2), (0, 0, 0, 0))
    canvas.alpha_composite(body, (mx, my))
    cw, ch = canvas.size
    dy, dx = ch * lean, cw * squeeze
    src = [(0, 0), (cw, 0), (cw, ch), (0, ch)]
    dst = [(0, dy * 0.55), (cw - dx, 0), (cw - dx, ch), (0, ch - dy * 0.55)]
    warped = canvas.transform((cw, ch), Image.PERSPECTIVE,
                              perspective_coeffs(src, dst), Image.BICUBIC)
    fwd = perspective_coeffs(dst, src)  # screen-space -> warped-space
    x0, y0, x1, y1 = warped.getbbox()
    phone_h = y1 - y0
    margin = blur * 3
    crop = Image.new("RGBA", (x1 - x0 + margin * 2, y1 - y0 + margin * 2), (0, 0, 0, 0))
    crop.alpha_composite(warped.crop((x0, y0, x1, y1)), (margin, margin))
    shadowed = drop(crop, blur=blur, alpha=alpha, offset=offset)
    k = target_h / phone_h
    out = shadowed.resize((round(shadowed.width * k), round(shadowed.height * k)),
                          Image.LANCZOS)

    def to_img(x, y):
        X, Y = x + pad + mx, y + pad + my
        a, b, c, d, e, f, g, h = fwd
        den = g * X + h * Y + 1
        u, v = (a * X + b * Y + c) / den, (d * X + e * Y + f) / den
        return ((u - x0 + margin + offset[0]) * k, (v - y0 + margin + offset[1]) * k)

    # Where the visible phone body sits inside `out`.
    body_box = ((margin + offset[0]) * k, (margin + offset[1]) * k,
                (margin + offset[0] + x1 - x0) * k, (margin + offset[1] + y1 - y0) * k)
    return out, to_img, body_box


def ground(d, vp, col, strength=1.0, spread=0.11):
    vx, vy = vp
    for i in range(-14, 15):
        d.line([vx, vy, vx + i * W * spread, H], fill=col + (int(22 * strength),), width=2)
    for i in range(1, 14):
        t = i / 13
        y = vy + (H - vy) * (t ** 2.0)
        d.line([0, y, W, y], fill=col + (int((8 + 26 * t) * strength),), width=2)


def render():
    bg = glow((W, H), [
        (W * 0.20, H * 0.62, W * 0.34, (22, 64, 160), 0.55),
        (W * 0.50, H * 0.50, W * 0.30, (18, 44, 110), 0.40),
        (W * 0.78, H * 0.46, W * 0.30, (120, 22, 40), 0.42),
        (W * 0.92, H * 0.95, W * 0.22, (60, 16, 30), 0.25),
    ], base=PAGE_BG).convert("RGBA")

    # Phone first (not yet pasted) so the scene can be aligned to the SOS button.
    target_h = int(H * 0.88)
    phone, to_img, box = build_phone(SHOT, target_h)
    px = int(W * 0.49 - (box[0] + box[2]) / 2)
    py = int(H * 0.5 - (box[1] + box[3]) / 2)
    sos = to_img(390, 858)
    sos = (sos[0] + px, sos[1] + py)
    req = to_img(390, 563)
    req = (req[0] + px, req[1] + py)
    right_edge = box[2] + px
    left_edge = box[0] + px

    horizon = H * 0.60
    vp = (W * 0.50, horizon)

    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)
    ground(d, vp, BLUE)

    # Calm blue request road on the left, running to the horizon.
    road_l = [(W * -0.10, H), (vp[0] - 150, horizon)]
    road_r = [(W * 0.25, H), (vp[0] - 110, horizon)]
    d.polygon([road_l[0], road_r[0], road_r[1], road_l[1]], fill=BLUE + (26,))
    for edge in (road_l, road_r):
        d.line(edge, fill=CYAN + (120,), width=3)
    # Dashed centre line, spaced in perspective.
    cx0, cx1 = W * 0.075, vp[0] - 130
    for i in range(18):
        t0, t1 = (i / 18) ** 0.55, ((i + 0.45) / 18) ** 0.55
        yA, yB = H - (H - horizon) * t0, H - (H - horizon) * t1
        xA, xB = cx0 + (cx1 - cx0) * t0, cx0 + (cx1 - cx0) * t1
        wdt = max(1, int(9 * (1 - t0)))
        d.line([xA, yA, xB, yB], fill=(200, 225, 255, int(160 * (1 - t0 * 0.7))), width=wdt)
    bg.alpha_composite(fx)

    # Soft blue light pooled under the road.
    pool = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(pool).polygon([road_l[0], road_r[0], road_r[1], road_l[1]],
                                 fill=CYAN + (40,))
    bg.alpha_composite(pool.filter(ImageFilter.GaussianBlur(40)))

    # Request path: from the request button out to a node that meets the road.
    path = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(path)
    node = (W * 0.14, H * 0.30)
    mid = (W * 0.22, H * 0.22)
    pts = [node, mid, (left_edge - 10, req[1] - 40)]
    for wdt, a in ((18, 30), (9, 70), (3, 220)):
        pd.line(pts, fill=CYAN + (a,), width=wdt, joint="curve")
    road_top = (W * 0.245, H * 0.79)
    for i in range(16):
        t = i / 15
        x = node[0] + (road_top[0] - node[0]) * t
        y = node[1] + (road_top[1] - node[1]) * t
        pd.ellipse([x - 3, y - 3, x + 3, y + 3], fill=CYAN + (int(200 - 120 * t),))
    pd.ellipse([node[0] - 30, node[1] - 30, node[0] + 30, node[1] + 30],
               outline=CYAN + (90,), width=3)
    pd.ellipse([node[0] - 12, node[1] - 12, node[0] + 12, node[1] + 12], fill=CYAN + (255,))
    net_lines(pd, W, H, [(int(W * 0.05), int(H * 0.14)), (int(W * 0.24), int(H * 0.07)),
                         (int(W * 0.08), int(H * 0.44))], BLUE, 40)
    bg.alpha_composite(path.filter(ImageFilter.GaussianBlur(0.6)))

    # Red pulse rings from the SOS control, fading towards the calm side.
    rings = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rings)
    sx, sy = sos
    for i, r in enumerate(range(170, 1100, 95)):
        a = int(170 * (1 - i / 10) ** 1.4)
        ry = r * 0.92
        rd.ellipse([sx - r, sy - ry, sx + r, sy + ry], outline=RED + (a,), width=4 if i < 3 else 3)
    # Column mask: faint on the calm (left) side, full strength to the right.
    col = [int(255 * min(1.0, max(0.12, (x - (sx - 380)) / 620))) for x in range(W)]
    shift = Image.new("L", (W, 1))
    shift.putdata(col)
    shift = shift.resize((W, H))
    glow_r = rings.filter(ImageFilter.GaussianBlur(10))
    rings.alpha_composite(glow_r)
    ra = rings.split()[3]
    rings.putalpha(Image.composite(ra, Image.new("L", (W, H), 0), shift))
    bg.alpha_composite(rings)

    # Red haze around the SOS area behind the phone.
    haze = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(haze).ellipse([sx - 260, sy - 240, sx + 420, sy + 240], fill=RED + (60,))
    bg.alpha_composite(haze.filter(ImageFilter.GaussianBlur(90)))

    # Hold dial on the right: 15 ticks (0.1 s each) and a progress arc part-way.
    dial = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dial)
    dcx, dcy, dr = W * 0.855, H * 0.40, 118
    dd.ellipse([dcx - dr - 40, dcy - dr - 40, dcx + dr + 40, dcy + dr + 40],
               fill=(20, 8, 13, 240))
    dd.ellipse([dcx - dr, dcy - dr, dcx + dr, dcy + dr], outline=(90, 40, 52, 255), width=10)
    prog = 0.72
    for wdt, a in ((26, 60), (10, 255)):
        dd.arc([dcx - dr, dcy - dr, dcx + dr, dcy + dr], -90, -90 + 360 * prog,
               fill=RED + (a,), width=wdt)
    for t in range(15):
        ang = math.radians(-90 + t * 24)
        r0, r1 = dr + 20, dr + (34 if t % 5 == 0 else 28)
        col = GOLD if t / 15 <= prog else (120, 90, 96)
        dd.line([dcx + r0 * math.cos(ang), dcy + r0 * math.sin(ang),
                 dcx + r1 * math.cos(ang), dcy + r1 * math.sin(ang)],
                fill=col + (230,), width=4)
    ang = math.radians(-90 + 360 * prog)
    hx, hy = dcx + dr * math.cos(ang), dcy + dr * math.sin(ang)
    dd.ellipse([hx - 13, hy - 13, hx + 13, hy + 13], fill=(255, 225, 228, 255))
    dd.ellipse([dcx - 34, dcy - 34, dcx + 34, dcy + 34], fill=RED + (255,))
    dd.ellipse([dcx - 54, dcy - 54, dcx + 54, dcy + 54], outline=RED + (110,), width=3)
    # Tilt the dial to sit in the same space as the phone.
    dcoef = perspective_coeffs(
        [(0, 0), (W, 0), (W, H), (0, H)],
        [(0, 0), (W, H * 0.03), (W, H * 0.97), (0, H)])
    dial = dial.transform((W, H), Image.PERSPECTIVE, dcoef, Image.BICUBIC)
    halo = dial.filter(ImageFilter.GaussianBlur(16))
    bg.alpha_composite(halo)
    bg.alpha_composite(dial)

    # Thin connector from the SOS control to the dial.
    link = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(link)
    a0 = (right_edge - 4, sy - 70)
    a1 = (dcx - dr - 52, dcy + 20)
    c = ((a0[0] + a1[0]) / 2, min(a0[1], a1[1]) - 20)
    curve = [((1 - t) ** 2 * a0[0] + 2 * (1 - t) * t * c[0] + t * t * a1[0],
              (1 - t) ** 2 * a0[1] + 2 * (1 - t) * t * c[1] + t * t * a1[1])
             for t in (i / 40 for i in range(41))]
    for wdt, a in ((10, 40), (3, 190)):
        ld.line(curve, fill=RED + (a,), width=wdt, joint="curve")
    ld.ellipse([a0[0] - 7, a0[1] - 7, a0[0] + 7, a0[1] + 7], fill=RED + (230,))
    bg.alpha_composite(link)

    # Vignette so the edges sink into the page background.
    edge = Image.new("L", (W, H), 255)
    ImageDraw.Draw(edge).rounded_rectangle([90, 70, W - 90, H - 70], radius=120, fill=0)
    edge = edge.filter(ImageFilter.GaussianBlur(70))
    bg = Image.composite(Image.new("RGBA", (W, H), PAGE_BG + (255,)), bg, edge)

    bg.alpha_composite(phone, (px, py))

    return save(bg, SHOT)


if __name__ == "__main__":
    render()
