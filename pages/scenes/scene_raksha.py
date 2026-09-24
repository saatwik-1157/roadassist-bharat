"""
Authority-oversight scene (shot "14-authority").

The real RAKSHA dashboard is a landscape desktop capture, so it is shown on a
3D desktop monitor (bezel, edge, neck and base drawn as geometry) standing on a
perspective ground grid. To its left, edge camera nodes on a road raise
detections; the pulses pass through a gold check node before reaching the
dashboard: the model raises signals, a person confirms them. Everything except
the screenshot is geometry.

    python pages/scenes/scene_raksha.py
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import *  # noqa: E402,F401,F403
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont  # noqa: E402

FONT = "C:/Windows/Fonts/segoeui.ttf"
FONT_B = "C:/Windows/Fonts/segoeuib.ttf"


def warp_to(img, quad, size):
    """Place an RGBA image onto a transparent canvas of `size`, filling `quad`."""
    w, h = img.size
    coeffs = perspective_coeffs([(0, 0), (w, 0), (w, h), (0, h)], quad)
    return img.transform(size, Image.PERSPECTIVE, coeffs, Image.BICUBIC)


def vignette(img):
    """Fade the frame's edges into the page colour so the scene has no hard border."""
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rounded_rectangle([W * 0.06, H * 0.08, W * 0.94, H * 0.92],
                                        radius=260, fill=255)
    m = m.filter(ImageFilter.GaussianBlur(110))
    return Image.composite(img, Image.new("RGBA", (W, H), PAGE_BG + (255,)), m)


def monitor_face(screen_w):
    """Flat front of the monitor: dark bezel with a thin chin, real screenshot inside."""
    shot = Image.open(SHOTS / "14-authority.png").convert("RGB")
    sw = screen_w
    sh = int(sw * shot.height / shot.width)
    shot = shot.resize((sw, sh), Image.LANCZOS).convert("RGBA")
    shot.putalpha(rounded_mask((sw, sh), 6))
    side, top, chin = 22, 22, 40
    fw, fh = sw + side * 2, sh + top + chin
    face = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    d = ImageDraw.Draw(face)
    d.rounded_rectangle([0, 0, fw - 1, fh - 1], radius=26, fill=(13, 17, 25, 255))
    d.rounded_rectangle([0, 0, fw - 1, fh - 1], radius=26, outline=(84, 102, 132, 255), width=3)
    d.rounded_rectangle([3, 3, fw - 4, fh - 4], radius=23, outline=(26, 33, 47, 255), width=2)
    face.alpha_composite(shot, (side, top))
    # Power light in the chin.
    cx, cy = fw // 2, fh - chin // 2
    d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=CYAN + (220,))
    return face


def camera_node(d, base, s):
    """A roadside edge device: pole, arm reaching over the road, camera housing.

    Returns the lens point (for the view cone) and the housing top (where the
    detection pulse leaves)."""
    bx, by = base
    top = (bx, by - 170 * s)
    pole = (82, 100, 130, 255)
    d.ellipse([bx - 18 * s, by - 6 * s, bx + 18 * s, by + 6 * s], fill=(44, 56, 76, 255))
    d.line([base, top], fill=pole, width=max(3, int(7 * s)))
    arm_end = (bx - 58 * s, top[1] + 4 * s)
    d.line([top, arm_end], fill=pole, width=max(2, int(5 * s)))
    hx, hy = arm_end
    d.rounded_rectangle([hx - 40 * s, hy, hx + 8 * s, hy + 24 * s], radius=int(6 * s) + 1,
                        fill=(30, 40, 58, 255), outline=(120, 146, 186, 255), width=2)
    lx, ly = hx - 40 * s, hy + 13 * s
    d.ellipse([lx - 8 * s, ly - 8 * s, lx + 8 * s, ly + 8 * s], fill=(12, 16, 24, 255),
              outline=CYAN + (255,), width=max(2, int(3 * s)))
    d.ellipse([lx - 3 * s, ly - 3 * s, lx + 3 * s, ly + 3 * s], fill=CYAN + (255,))
    # Status LED on the housing.
    d.ellipse([hx - 2 * s, hy + 6 * s, hx + 4 * s, hy + 12 * s], fill=GREEN + (255,))
    return (lx, ly), (hx - 16 * s, hy)


def bezier(p0, p1, p2, n=70):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
            for t in (i / n for i in range(n + 1))]


def render():
    bg = glow((W, H), [
        (W * 0.62, H * 0.44, W * 0.44, (24, 66, 158), 0.52),
        (W * 0.18, H * 0.66, W * 0.26, (10, 92, 116), 0.36),
        (W * 0.24, H * 0.30, W * 0.12, (110, 84, 36), 0.16),
    ], base=PAGE_BG).convert("RGBA")

    # Perspective ground grid.
    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)
    hy = H * 0.60
    vx = W * 0.40
    for i in range(-14, 20):
        d.line([vx, hy, vx + i * W * 0.10, H], fill=BLUE + (22,), width=2)
    for i in range(1, 13):
        t = i / 12
        y = hy + (H - hy) * (t ** 2.0)
        d.line([0, y, W, y], fill=BLUE + (int(30 * t) + 6,), width=2)
    bg.alpha_composite(fx)
    bg = vignette(bg)

    # Road receding to its own vanishing point on the left, away from the monitor.
    rvx = 250
    rd = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    r = ImageDraw.Draw(rd)
    road = [(rvx - 10, hy), (rvx + 10, hy), (640, H), (-140, H)]
    r.polygon(road, fill=(17, 21, 29, 240))
    r.line([road[0], road[3]], fill=(96, 110, 136, 160), width=3)
    r.line([road[1], road[2]], fill=(96, 110, 136, 160), width=3)
    for k in range(10):  # centre dashes, growing toward the viewer
        t0 = (k / 10) ** 1.7
        t1 = ((k + 0.5) / 10) ** 1.7
        x0, y0 = rvx + (250 - rvx) * t0, hy + (H - hy) * t0
        x1, y1 = rvx + (250 - rvx) * t1, hy + (H - hy) * t1
        r.line([(x0, y0), (x1, y1)], fill=(214, 204, 172, 110), width=max(2, int(2 + 8 * t1)))
    # Let the far end of the road dissolve into the haze instead of ending in a point.
    fade = Image.new("L", (W, H), 255)
    fdraw = ImageDraw.Draw(fade)
    for y in range(int(hy), int(hy) + 170):
        fdraw.line([(0, y), (W, y)], fill=int(255 * ((y - hy) / 170) ** 1.3))
    fdraw.rectangle([0, 0, W, hy], fill=0)
    rd.putalpha(ImageChops.multiply(rd.split()[3], fade))
    bg.alpha_composite(rd)

    def on_verge(t):
        return (rvx + 10 + (640 - rvx - 10) * t, hy + (H - hy) * t)

    # Road damage in the right lane, each boxed the way the detector reports it.
    hits = [(372, 905, 44, RED), (330, 775, 28, GOLD), (297, 688, 17, RED)]
    cams = [(on_verge(0.86), 1.25), (on_verge(0.50), 0.86), (on_verge(0.24), 0.58)]

    cone = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cone)
    dm = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    m = ImageDraw.Draw(dm)
    for x, y, s, col in hits:
        m.ellipse([x - s * 1.7, y - s * 0.62, x + s * 1.7, y + s * 0.62], fill=col + (110,))
    bg.alpha_composite(dm.filter(ImageFilter.GaussianBlur(14)))
    m = ImageDraw.Draw(bg)
    for x, y, s, col in hits:
        m.ellipse([x - s, y - s * 0.34, x + s, y + s * 0.34], fill=(22, 12, 14, 255),
                  outline=col + (255,), width=3)
        m.rectangle([x - s * 1.4, y - s * 0.8, x + s * 1.4, y + s * 0.6],
                    outline=col + (210,), width=2)
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    lenses = [camera_node(probe, base, s) for base, s in cams]
    for ((lx, ly), _), (x, y, s, col) in zip(lenses, hits):
        cd.polygon([(lx, ly), (x - s * 1.4, y - s * 0.1), (x + s * 1.4, y + s * 0.2)],
                   fill=CYAN + (34,))
    bg.alpha_composite(cone.filter(ImageFilter.GaussianBlur(3)))

    # Monitor, turned slightly to face the road.
    face = monitor_face(1000)
    fw, fh = face.size
    TL, TR, BR, BL = (640, 118), (1548, 58), (1548, 740), (640, 690)
    quad = [TL, TR, BR, BL]
    # Stand: neck and base, drawn before the screen so the screen overlaps them.
    st = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(st)
    ncx = 1110
    sd.ellipse([ncx - 300, 870, ncx + 300, 960], fill=(0, 0, 0, 170))
    st = st.filter(ImageFilter.GaussianBlur(26))
    sd = ImageDraw.Draw(st)
    sd.polygon([(ncx - 250, 894), (ncx + 230, 880), (ncx + 270, 906), (ncx - 220, 924)],
               fill=(30, 38, 54, 255))
    sd.polygon([(ncx - 220, 924), (ncx + 270, 906), (ncx + 270, 916), (ncx - 220, 934)],
               fill=(14, 18, 27, 255))
    sd.line([(ncx - 250, 894), (ncx + 230, 880)], fill=(96, 118, 152, 255), width=2)
    sd.polygon([(ncx - 34, 690), (ncx + 34, 686), (ncx + 30, 902), (ncx - 38, 906)],
               fill=(24, 31, 45, 255))
    sd.polygon([(ncx + 34, 686), (ncx + 50, 680), (ncx + 46, 896), (ncx + 30, 902)],
               fill=(14, 18, 27, 255))
    sd.line([(ncx - 34, 690), (ncx - 38, 906)], fill=(80, 98, 128, 255), width=2)
    bg.alpha_composite(st)

    # Screen glow onto the scene, then the monitor's edge (thickness), then the face.
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(halo).polygon(quad, fill=(60, 120, 255, 90))
    bg.alpha_composite(halo.filter(ImageFilter.GaussianBlur(50)))
    edge = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.polygon([(TR[0] - 6, TR[1] + 20), (TR[0] + 10, TR[1] + 30), (BR[0] + 10, BR[1] - 26),
                (BR[0] - 6, BR[1] - 18)], fill=(40, 50, 68, 255))
    bg.alpha_composite(edge)
    warped = warp_to(face, quad, (W, H))
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow.putalpha(warped.split()[3].filter(ImageFilter.GaussianBlur(28))
                    .point(lambda v: v * 120 // 255))
    bg.alpha_composite(shadow, (14, 22))
    bg.alpha_composite(warped)

    # Cameras (in front of the road, left of the monitor).
    cd = ImageDraw.Draw(bg)
    lenses = [camera_node(cd, base, s) for base, s in cams]

    # Human-in-the-loop check node between the detections and the dashboard.
    gx, gy = 470, 330
    gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(gl).ellipse([gx - 100, gy - 100, gx + 100, gy + 100], fill=GOLD + (80,))
    bg.alpha_composite(gl.filter(ImageFilter.GaussianBlur(40)))

    # Pulses: camera -> check node (cyan), check node -> dashboard (gold).
    pl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    p = ImageDraw.Draw(pl)
    paths = []
    for k, (_, (ux, uy)) in enumerate(lenses):
        end = (gx - 30 + k * 30, gy + 58 - (k == 1) * 6)
        paths.append((bezier((ux, uy - 4), (ux - 70 + k * 40, (uy + gy) / 2), end), CYAN))
    target = (TL[0] + 8, 330)
    paths.append((bezier((gx + 66, gy), ((gx + target[0]) / 2, gy - 40), target), GOLD))
    for pts, col in paths:
        p.line(pts, fill=col + (40,), width=10, joint="curve")
    bg.alpha_composite(pl.filter(ImageFilter.GaussianBlur(5)))
    p = ImageDraw.Draw(bg)
    for pts, col in paths:
        p.line(pts, fill=col + (110,), width=2, joint="curve")
        for i in range(0, len(pts), 7):
            x, y = pts[i]
            rr = 3 + 2 * (i % 21 == 0)
            p.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col + (235,))
    tx, ty = pts[-1]
    p.polygon([(tx + 4, ty), (tx - 14, ty - 9), (tx - 14, ty + 9)], fill=GOLD + (255,))

    # The check node itself.
    p.ellipse([gx - 50, gy - 50, gx + 50, gy + 50], fill=(34, 27, 15, 255),
              outline=GOLD + (255,), width=4)
    p.ellipse([gx - 64, gy - 64, gx + 64, gy + 64], outline=GOLD + (80,), width=2)
    p.line([(gx - 20, gy + 1), (gx - 5, gy + 17), (gx + 22, gy - 16)], fill=GOLD + (255,),
           width=8, joint="curve")

    f_b = ImageFont.truetype(FONT_B, 22)
    f_r = ImageFont.truetype(FONT, 19)
    lbl = "confirm"
    p.text((gx - p.textlength(lbl, font=f_b) / 2, gy - 104), lbl, font=f_b, fill=GOLD + (240,))
    (bx, by), _ = cams[0]
    p.text((bx + 22, by - 150), "YOLO11", font=f_b, fill=CYAN + (235,))

    return save(bg, "14-authority")


if __name__ == "__main__":
    render()
