"""
Off-grid SOS scene: the real 09-offgrid-sos screen in a cold, dark field.

The distant cell tower has no coverage (its signal arcs are broken, red and
struck through), yet the phone holds the incident itself: a warm glow, a small
on-device journal stack beside it, and a GPS satellite whose fix needs no
internet at all.

    python pages/scenes/scene_offgrid.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import *  # noqa: E402,F401,F403

from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

FONT = "C:/Windows/Fonts/segoeui.ttf"
FONT_B = "C:/Windows/Fonts/segoeuib.ttf"


def font(size, bold=False):
    try:
        return ImageFont.truetype(FONT_B if bold else FONT, size)
    except OSError:
        return ImageFont.load_default()


def phone(shot, height, lean=0.14):
    """The real screenshot in a device body, tilted and trimmed to its outline."""
    body = device_frame(SHOTS / f"{shot}.png", screen_w=760)
    t = tilt(body, lean=lean)
    t = t.crop(t.getbbox())
    return t.resize((int(t.width * height / t.height), height), Image.LANCZOS)


def soft_shadow(obj, blur=30, alpha=170, offset=(22, 30)):
    """A blurred contact shadow, padded so the blur is never clipped."""
    pad = blur * 3
    m = Image.new("L", (obj.width + pad * 2, obj.height + pad * 2), 0)
    m.paste(obj.split()[3], (pad, pad))
    a = m.filter(ImageFilter.GaussianBlur(blur))
    sh = Image.new("RGBA", m.size, (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: int(v * alpha / 255)))
    return sh, (offset[0] - pad, offset[1] - pad)


def slab(d, x, y, w, depth, thick, top, edge, alpha=255):
    """One isometric slab; (x, y) is the front-left top corner."""
    dx, dy = depth * 0.86, -depth * 0.50
    tl, tr = (x, y), (x + w, y)
    br_, bl_ = (x + w + dx, y + dy), (x + dx, y + dy)
    side = tuple(max(0, c - 10) for c in top)
    front = tuple(max(0, c - 18) for c in top)
    # front and right faces
    d.polygon([tl, tr, (tr[0], tr[1] + thick), (tl[0], tl[1] + thick)], fill=front + (alpha,))
    d.polygon([tr, br_, (br_[0], br_[1] + thick), (tr[0], tr[1] + thick)], fill=side + (alpha,))
    # top face and its lit edges
    d.polygon([tl, tr, br_, bl_], fill=top + (alpha,))
    d.line([bl_, tl, tr, br_], fill=edge + (int(alpha * 0.9),), width=2)
    d.line([bl_, br_], fill=edge + (int(alpha * 0.45),), width=1)
    return tl, tr, br_, bl_


def dashed_arc(d, box, start, end, col, width, dash=9, gap=7):
    ang = start
    while ang < end:
        a2 = min(end, ang + dash)
        d.arc(box, ang, a2, fill=col, width=width)
        ang = a2 + gap


def render():
    bg = glow((W, H), [
        (W * 0.36, H * 0.52, W * 0.34, (150, 70, 40), 0.30),   # warm, contained
        (W * 0.80, H * 0.30, W * 0.30, (18, 38, 92), 0.30),    # cold sky
        (W * 0.12, H * 0.90, W * 0.22, (12, 40, 70), 0.20),
    ], base=PAGE_BG).convert("RGBA")

    # ── ground grid, cold and faint ─────────────────────────────────────────
    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)
    hz = H * 0.66
    for i in range(-10, 22):
        d.line([W * 0.52, hz, W * 0.52 + i * W * 0.09, H], fill=BLUE + (16,), width=2)
    for i in range(1, 11):
        t = i / 10
        d.line([0, hz + (H - hz) * t ** 2.0, W, hz + (H - hz) * t ** 2.0],
               fill=BLUE + (int(22 * t) + 5,), width=2)
    # faint stars in the cold sky
    for k in range(46):
        x = (k * 397 + 131) % W
        y = (k * 211 + 57) % int(H * 0.55)
        if W * 0.18 < x < W * 0.56 and y > H * 0.05:
            continue
        a = 40 + (k * 37) % 70
        d.ellipse([x - 1, y - 1, x + 1, y + 1], fill=(170, 190, 230, a))
    bg.alpha_composite(fx)

    # ── distant cell tower, no coverage ─────────────────────────────────────
    tw = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tw)
    tx, base, top_y = 1325, 690, 330
    half_b, half_t = 70, 14
    steel = (78, 92, 118, 230)
    lx0, rx0 = tx - half_b, tx + half_b
    lx1, rx1 = tx - half_t, tx + half_t
    d.line([lx0, base, lx1, top_y], fill=steel, width=4)
    d.line([rx0, base, rx1, top_y], fill=steel, width=4)
    levels = 8
    pts = []
    for i in range(levels + 1):
        t = i / levels
        y = base + (top_y - base) * t
        xl = lx0 + (lx1 - lx0) * t
        xr = rx0 + (rx1 - rx0) * t
        pts.append((xl, xr, y))
        d.line([xl, y, xr, y], fill=(70, 84, 108, 200), width=2)
    for (xl, xr, y), (xl2, xr2, y2) in zip(pts, pts[1:]):
        d.line([xl, y, xr2, y2], fill=(62, 76, 100, 170), width=2)
        d.line([xr, y, xl2, y2], fill=(62, 76, 100, 170), width=2)
    # mast and antenna panels
    d.line([tx, top_y, tx, top_y - 70], fill=steel, width=4)
    for sx in (-1, 1):
        px = tx + sx * 22
        d.rectangle([px - 5, top_y - 58, px + 5, top_y - 12], fill=(92, 106, 134, 240))
    d.rectangle([tx - 5, top_y - 66, tx + 5, top_y - 22], fill=(92, 106, 134, 240))
    # dead beacon
    d.ellipse([tx - 6, top_y - 82, tx + 6, top_y - 70], fill=(120, 40, 50, 255))
    # tower foot
    d.ellipse([tx - 110, base - 12, tx + 110, base + 16], fill=(20, 28, 40, 160))
    bg.alpha_composite(tw)

    # broken, faded signal arcs
    sg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(sg)
    cx, cy = tx, top_y - 40
    for k, r in enumerate((60, 100, 142)):
        a = 170 - k * 45
        dashed_arc(d, [cx - r, cy - r, cx + r, cy + r], 200, 250, RED + (a,), 5)
        dashed_arc(d, [cx - r, cy - r, cx + r, cy + r], 290, 340, RED + (a,), 5)
    bg.alpha_composite(sg.filter(ImageFilter.GaussianBlur(5)))
    bg.alpha_composite(sg)
    # the strike-through: a no-coverage badge
    bd = ImageDraw.Draw(bg)
    bx, by, br = cx + 118, cy - 118, 26
    bd.ellipse([bx - br, by - br, bx + br, by + br], fill=(40, 14, 20, 235),
               outline=RED + (255,), width=3)
    o = br * 0.46
    bd.line([bx - o, by - o, bx + o, by + o], fill=RED + (255,), width=5)
    bd.line([bx - o, by + o, bx + o, by - o], fill=RED + (255,), width=5)
    bd.text((tx, base + 40), "NO NETWORK", font=font(20, True), fill=(255, 120, 132, 220),
            anchor="mm")

    # ── the phone ───────────────────────────────────────────────────────────
    ph = phone("09-offgrid-sos", 900, lean=0.13)
    px, py = 330, (H - ph.height) // 2 + 4
    # warm contained aura hugging the device
    aura = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ad = ImageDraw.Draw(aura)
    ad.rounded_rectangle([px + 10, py + 30, px + ph.width - 10, py + ph.height - 30],
                         radius=80, fill=(255, 150, 90, 80))
    bg.alpha_composite(aura.filter(ImageFilter.GaussianBlur(60)))

    # GPS satellite + thin line to the phone (the fix works with no internet)
    sat = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(sat)
    sx, sy = 1010, 118
    target = (px + ph.width - 4, py + ph.height * 0.17)
    n = 44
    for i in range(n):
        if i % 2:
            continue
        t0, t1 = i / n, (i + 1) / n
        a = int(60 + 150 * t0)
        d.line([sx + (target[0] - sx) * t0, sy + (target[1] - sy) * t0,
                sx + (target[0] - sx) * t1, sy + (target[1] - sy) * t1],
               fill=CYAN + (a,), width=2)
    # body and panels, slightly rotated feel
    for side in (-1, 1):
        x0 = sx + side * 22
        x1 = sx + side * 88
        xa, xb = min(x0, x1), max(x0, x1)
        d.polygon([(xa, sy - 16), (xb, sy - 22), (xb, sy + 10), (xa, sy + 16)],
                  fill=(28, 58, 110, 240), outline=(90, 150, 230, 255))
        for k in range(1, 4):
            xx = xa + (xb - xa) * k / 4
            d.line([xx, sy - 18, xx, sy + 14], fill=(70, 120, 200, 200), width=1)
        d.line([sx + side * 14, sy, sx + side * 22, sy], fill=(150, 170, 200, 255), width=3)
    d.rounded_rectangle([sx - 15, sy - 20, sx + 15, sy + 20], radius=5,
                        fill=(170, 150, 100, 255), outline=GOLD + (255,), width=2)
    d.line([sx, sy + 20, sx, sy + 34], fill=(180, 190, 210, 255), width=2)
    d.ellipse([sx - 5, sy + 32, sx + 5, sy + 40], fill=CYAN + (255,))
    bg.alpha_composite(sat.filter(ImageFilter.GaussianBlur(4)))
    bg.alpha_composite(sat)
    bd = ImageDraw.Draw(bg)
    bd.text((sx, sy - 44), "GPS FIX", font=font(20, True), fill=CYAN + (230,), anchor="mm")
    bd.text((sx, sy + 62), "no internet needed", font=font(17), fill=(150, 200, 215, 200),
            anchor="mm")

    # receiving pulse where the GPS line lands, behind the device edge
    pr = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(pr)
    gx, gy = target
    for r, a in ((22, 170), (38, 100), (56, 50)):
        d.ellipse([gx - r, gy - r, gx + r, gy + r], outline=CYAN + (a,), width=2)
    bg.alpha_composite(pr)

    # phone shadow + phone
    sh, (ox, oy) = soft_shadow(ph)
    bg.alpha_composite(sh, (px + ox, py + oy))
    bg.alpha_composite(ph, (px, py))
    bd = ImageDraw.Draw(bg)
    bd.ellipse([gx - 6, gy - 6, gx + 6, gy + 6], fill=CYAN + (255,))

    # ── on-device journal: the incident held locally ────────────────────────
    vj = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(vj)
    vx, vy = 900, 760
    # warm pool under the stack
    pool = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(pool).ellipse([vx - 40, vy - 30, vx + 330, vy + 90],
                                 fill=(255, 150, 80, 70))
    bg.alpha_composite(pool.filter(ImageFilter.GaussianBlur(34)))
    tones = [((34, 24, 26), (130, 80, 60)), ((44, 30, 30), (170, 110, 70)),
             ((56, 36, 34), (210, 150, 90)), ((70, 40, 40), GOLD)]
    sw_, sd_ = 200, 120
    for i, (topc, edge) in enumerate(tones):
        slab(d, vx, vy - i * 30, sw_, sd_, 18, topc, edge)
    # the top slab carries the incident: a red marker and ledger lines
    ty = vy - 3 * 30

    def on_top(u, v):
        return (vx + u * sw_ + v * sd_ * 0.86, ty - v * sd_ * 0.50)

    mx, my = on_top(0.14, 0.5)
    d.ellipse([mx - 11, my - 7, mx + 11, my + 7], fill=RED + (255,))
    for k, v in enumerate((0.72, 0.5, 0.28)):
        d.line([on_top(0.30, v), on_top(0.30 + 0.55 - k * 0.1, v)],
               fill=(240, 210, 160, 190), width=3)
    bg.alpha_composite(vj)
    # link from phone to the stack
    lk = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lk)
    a0 = (px + ph.width * 0.93, py + ph.height * 0.62)
    a1 = on_top(0.03, 0.80)
    d.line([a0, a1], fill=GOLD + (170,), width=2)
    d.ellipse([a0[0] - 5, a0[1] - 5, a0[0] + 5, a0[1] + 5], fill=GOLD + (255,))
    d.ellipse([a1[0] - 5, a1[1] - 5, a1[0] + 5, a1[1] + 5], fill=GOLD + (255,))
    bg.alpha_composite(lk)
    bd = ImageDraw.Draw(bg)
    bd.text((vx + 150, vy + 70), "ON-DEVICE JOURNAL", font=font(20, True),
            fill=GOLD + (235,), anchor="mm")
    bd.text((vx + 150, vy + 98), "held locally  \u00b7  nothing transmitted", font=font(17),
            fill=(210, 190, 150, 200), anchor="mm")

    # vignette so the edges settle into the page background
    vg = Image.new("L", (W, H), 0)
    ImageDraw.Draw(vg).rounded_rectangle([60, 40, W - 60, H - 40], radius=200, fill=255)
    vg = vg.filter(ImageFilter.GaussianBlur(90))
    base_img = Image.new("RGBA", (W, H), PAGE_BG + (255,))
    out = Image.composite(bg, base_img, vg)
    save(out, "09-offgrid-sos")
    return out


if __name__ == "__main__":
    render()
