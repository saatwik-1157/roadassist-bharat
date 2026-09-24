"""
Idempotent sync scene: the real 11-sync-complete screen, back on a network.

Queued operations leave the on-device journal as slabs travelling along an arc
to a small isometric server stack. A retried operation carries the same
client-minted id, so at the server the duplicate slab fades into the one that
was already applied: the same incident, never a second one.

    python pages/scenes/scene_sync.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import *  # noqa: E402,F401,F403
from scene_offgrid import font, phone, soft_shadow, slab  # noqa: E402

from PIL import Image, ImageDraw, ImageFilter  # noqa: E402


def bezier(p0, p1, p2, t):
    u = 1 - t
    return (u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1])


def server_unit(d, x, y, w, depth, h, tone, lit, seed):
    """One isometric server box, front face h tall, with blades and LEDs."""
    slab(d, x, y, w, depth, h, tone, (70, 96, 132))
    rows = 4
    step = h / rows
    for k in range(rows):
        by = y + k * step + step * 0.24
        d.rectangle([x + 8, by, x + w - 8, by + step * 0.52],
                    fill=tuple(c + 7 for c in tone) + (255,))
        c = lit if (k + seed) % 3 else CYAN
        d.rectangle([x + 14, by + step * 0.14, x + 24, by + step * 0.38], fill=c + (255,))
        d.rectangle([x + 30, by + step * 0.14, x + 40, by + step * 0.38],
                    fill=c + (140,))
        for j in range(6):
            gx = x + w - 20 - j * 12
            d.line([gx, by + step * 0.1, gx, by + step * 0.42], fill=(40, 52, 72, 255), width=2)


def render():
    bg = glow((W, H), [
        (W * 0.34, H * 0.50, W * 0.34, (20, 70, 160), 0.46),
        (W * 0.78, H * 0.46, W * 0.28, (10, 110, 110), 0.32),
        (W * 0.60, H * 0.10, W * 0.22, (20, 60, 90), 0.20),
    ], base=PAGE_BG).convert("RGBA")

    # ── ground grid ─────────────────────────────────────────────────────────
    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)
    hz = H * 0.66
    for i in range(-10, 22):
        d.line([W * 0.52, hz, W * 0.52 + i * W * 0.09, H], fill=BLUE + (20,), width=2)
    for i in range(1, 11):
        t = i / 10
        y = hz + (H - hz) * t ** 2.0
        d.line([0, y, W, y], fill=BLUE + (int(26 * t) + 6,), width=2)
    bg.alpha_composite(fx)

    # ── server stack, isometric ─────────────────────────────────────────────
    sv = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(sv)
    sx, base = 1010, 770
    uw, ud, uh, gap = 230, 130, 74, 10
    pool = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(pool).ellipse([sx - 80, base - 40, sx + uw + 180, base + 70],
                                 fill=CYAN + (60,))
    bg.alpha_composite(pool.filter(ImageFilter.GaussianBlur(40)))
    tones = [(16, 22, 34), (18, 25, 38), (21, 29, 43)]
    for i in range(3):
        y = base - uh - i * (uh + gap)
        server_unit(d, sx, y, uw, ud, uh, tones[i], GREEN, i)
    top_y = base - uh - 2 * (uh + gap)
    bg.alpha_composite(sv)

    def on_server_top(u, v):
        return (sx + u * uw + v * ud * 0.86, top_y - v * ud * 0.50)

    bd = ImageDraw.Draw(bg)
    bd.text((sx + uw / 2 + ud * 0.43, base + 44), "PLATFORM", font=font(20, True),
            fill=(150, 225, 235, 230), anchor="mm")
    bd.text((sx + uw / 2 + ud * 0.43, base + 72), "de-duplicates on op_id", font=font(17),
            fill=(150, 190, 205, 200), anchor="mm")

    # ── the phone ───────────────────────────────────────────────────────────
    ph = phone("11-sync-complete", 900, lean=0.13)
    px, py = 300, (H - ph.height) // 2 + 4
    aura = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(aura).rounded_rectangle(
        [px + 10, py + 30, px + ph.width - 10, py + ph.height - 30], radius=80,
        fill=(70, 150, 255, 70))
    bg.alpha_composite(aura.filter(ImageFilter.GaussianBlur(60)))

    # ── the sync arc: phone -> platform ─────────────────────────────────────
    p0 = (px + ph.width - 6, py + ph.height * 0.40)
    land = on_server_top(0.42, 0.5)
    p2 = (land[0], land[1] - 40)
    p1 = ((p0[0] + p2[0]) / 2, 90)
    arc = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(arc)
    pts = [bezier(p0, p1, p2, i / 80) for i in range(81)]
    for width, a in ((16, 30), (8, 60)):
        d.line(pts, fill=CYAN + (a,), width=width, joint="curve")
    bg.alpha_composite(arc.filter(ImageFilter.GaussianBlur(6)))
    arc = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(arc)
    for i in range(0, 80, 2):
        d.line([pts[i], pts[i + 1]], fill=CYAN + (200,), width=3)
    bg.alpha_composite(arc)

    # queued operations travelling along the arc
    ops = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ops)
    sw_, sd_, st_ = 78, 44, 12
    for t in (0.18, 0.40, 0.62):
        cx, cy = bezier(p0, p1, p2, t)
        x0 = cx - (sw_ + sd_ * 0.86) / 2
        y0 = cy + sd_ * 0.25
        slab(d, x0, y0, sw_, sd_, st_, (22, 44, 70), CYAN)
        # tiny id stripe on each slab
        d.line([x0 + 12 + sd_ * 0.43, y0 - sd_ * 0.25, x0 + 50 + sd_ * 0.43, y0 - sd_ * 0.25],
               fill=(190, 240, 250, 220), width=3)
    bg.alpha_composite(ops.filter(ImageFilter.GaussianBlur(8)))
    bg.alpha_composite(ops)
    bd = ImageDraw.Draw(bg)
    lx, ly = bezier(p0, p1, p2, 0.40)
    bd.text((lx, ly - 46), "op_id", font=font(19, True), fill=CYAN + (235,), anchor="mm")

    # ── dedupe at the platform: the retry merges into the applied op ───────
    mg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(mg)
    ax, ay = on_server_top(0.18, 0.62)
    aw, adp, at = 110, 62, 14
    # the duplicate: same slab, arriving again, faded and dashed
    gx, gy = ax + 150, ay - 130
    slab(d, gx, gy, aw, adp, at, (52, 44, 24), GOLD, alpha=135)
    # its path collapsing into the applied slab
    for k in range(10):
        if k % 2:
            continue
        t0, t1 = k / 10, (k + 1) / 10
        sx0, sy0 = gx + 20, gy + at
        ex, ey = ax + 60, ay - 18
        d.line([sx0 + (ex - sx0) * t0, sy0 + (ey - sy0) * t0,
                sx0 + (ex - sx0) * t1, sy0 + (ey - sy0) * t1], fill=GOLD + (170,), width=2)
    # the applied op, sitting on the platform
    slab(d, ax, ay, aw, adp, at, (18, 58, 48), GREEN)
    cxk, cyk = ax + aw / 2 + adp * 0.43, ay - adp * 0.25
    d.line([(cxk - 13, cyk), (cxk - 3, cyk + 8), (cxk + 15, cyk - 9)], fill=GREEN + (255,),
           width=4)
    bg.alpha_composite(mg.filter(ImageFilter.GaussianBlur(7)))
    bg.alpha_composite(mg)
    bd = ImageDraw.Draw(bg)
    lcx = gx + (aw + adp * 0.86) / 2
    bd.text((lcx, gy - adp * 0.5 - 50), "duplicate", font=font(19, True),
            fill=GOLD + (225,), anchor="mm")
    bd.text((lcx, gy - adp * 0.5 - 26), "same op_id, merged", font=font(16),
            fill=(210, 190, 150, 195), anchor="mm")
    bd.text((ax - 18, ay + 8), "applied", font=font(19, True), fill=GREEN + (240,),
            anchor="rm")

    # ── restored signal from the device ─────────────────────────────────────
    sg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(sg)
    ox, oy = px + ph.width + 4, py + 120
    for k, r in enumerate((28, 52, 76)):
        d.arc([ox - r, oy - r, ox + r, oy + r], 262, 338, fill=GREEN + (230 - k * 50,), width=5)
    d.ellipse([ox - 7, oy - 7, ox + 7, oy + 7], fill=GREEN + (255,))
    bg.alpha_composite(sg.filter(ImageFilter.GaussianBlur(6)))
    bg.alpha_composite(sg)

    # phone shadow + phone (drawn last so nothing sits on its screen)
    sh, (sox, soy) = soft_shadow(ph)
    bg.alpha_composite(sh, (px + sox, py + soy))
    bg.alpha_composite(ph, (px, py))
    bd = ImageDraw.Draw(bg)
    bd.ellipse([p0[0] - 6, p0[1] - 6, p0[0] + 6, p0[1] + 6], fill=CYAN + (255,))

    vg = Image.new("L", (W, H), 0)
    ImageDraw.Draw(vg).rounded_rectangle([60, 40, W - 60, H - 40], radius=200, fill=255)
    vg = vg.filter(ImageFilter.GaussianBlur(90))
    out = Image.composite(bg, Image.new("RGBA", (W, H), PAGE_BG + (255,)), vg)
    save(out, "11-sync-complete")
    return out


if __name__ == "__main__":
    render()
