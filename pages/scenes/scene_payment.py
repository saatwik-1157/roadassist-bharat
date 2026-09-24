"""
Settlement scene (shot "16-payment").

The real payment screen is a short portrait crop, so it is presented as a
floating, tilted glass invoice card rather than a phone. Beside it, a small
isometric server carries a gold verification shield: the client never decides
money arrived, the server verifies the settlement. Two confirmation arrows head
for the card; only one lands, the other stops at a lock ("paid once" holds under
concurrent confirmations). Everything except the screenshot is geometry.

    python pages/scenes/scene_payment.py
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import *  # noqa: E402,F401,F403
from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

FONT = "C:/Windows/Fonts/segoeui.ttf"
FONT_B = "C:/Windows/Fonts/segoeuib.ttf"


def warp_to(img, quad, size):
    """Place an RGBA image onto a transparent canvas of `size`, filling `quad`."""
    w, h = img.size
    coeffs = perspective_coeffs([(0, 0), (w, 0), (w, h), (0, h)], quad)
    return img.transform(size, Image.PERSPECTIVE, coeffs, Image.BICUBIC)


def invoice_card(target_h):
    """The real screenshot, trimmed of its browser gutter/scrollbar, as a glass card."""
    shot = Image.open(SHOTS / "16-payment.png").convert("RGB")
    # The page content sits between x=32 and x=462; outside it is empty page
    # margin and the browser scrollbar. Trimming it keeps only real UI.
    shot = shot.crop((32, 0, 463, shot.height))
    pad = 14
    sw = int(shot.width * (target_h - pad * 2) / shot.height)
    sh = target_h - pad * 2
    shot = shot.resize((sw, sh), Image.LANCZOS).convert("RGBA")
    shot.putalpha(rounded_mask((sw, sh), 26))
    cw, ch = sw + pad * 2, sh + pad * 2
    card = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, cw - 1, ch - 1], radius=38, fill=(20, 26, 38, 235))
    d.rounded_rectangle([0, 0, cw - 1, ch - 1], radius=38, outline=(96, 118, 152, 255), width=2)
    d.rounded_rectangle([3, 3, cw - 4, ch - 4], radius=35, outline=(40, 52, 72, 255), width=2)
    card.alpha_composite(shot, (pad, pad))
    # A faint glass sheen across the top-left.
    sheen = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.polygon([(0, 0), (cw * 0.55, 0), (0, ch * 0.32)], fill=(255, 255, 255, 14))
    sheen.putalpha(Image.composite(sheen.split()[3], Image.new("L", (cw, ch), 0),
                                   rounded_mask((cw, ch), 38)))
    card.alpha_composite(sheen)
    return card


def iso_server(d, cx, base_y, w, h, depth):
    """A small isometric server block: front, right and top faces with LEDs."""
    fx0, fx1 = cx - w / 2, cx + w / 2
    fy0, fy1 = base_y - h, base_y
    dx, dy = depth * 0.70, -depth * 0.46
    d.polygon([(fx1, fy0), (fx1 + dx, fy0 + dy), (fx1 + dx, fy1 + dy), (fx1, fy1)],
              fill=(15, 20, 31, 255))
    d.polygon([(fx0, fy0), (fx1, fy0), (fx1 + dx, fy0 + dy), (fx0 + dx, fy0 + dy)],
              fill=(34, 44, 62, 255))
    d.polygon([(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1)], fill=(22, 29, 43, 255))
    d.line([(fx0, fy0), (fx1, fy0), (fx1 + dx, fy0 + dy)], fill=(92, 116, 152, 255), width=2)
    d.line([(fx0, fy0), (fx0, fy1)], fill=(70, 90, 122, 255), width=2)
    blades = 5
    step = h / blades
    for k in range(blades):
        by = fy0 + k * step + step * 0.2
        d.rectangle([fx0 + 8, by, fx1 - 8, by + step * 0.58], fill=(28, 37, 54, 255))
        for j in range(3):
            c = (CYAN if (k + j) % 3 else GREEN) if j < 2 else BLUE
            lx = fx0 + 16 + j * 16
            d.rectangle([lx, by + step * 0.2, lx + 8, by + step * 0.38], fill=c + (255,))
        d.line([(fx1 - 60, by + step * 0.29), (fx1 - 16, by + step * 0.29)],
               fill=(60, 76, 102, 255), width=3)
    return (fx0 + fx1 + dx) / 2, fy0 + dy / 2


def shield(d, cx, cy, s):
    """Gold shield with a check mark."""
    pts = [(cx, cy - s), (cx + s * 0.82, cy - s * 0.66), (cx + s * 0.74, cy + s * 0.18),
           (cx, cy + s), (cx - s * 0.74, cy + s * 0.18), (cx - s * 0.82, cy - s * 0.66)]
    d.polygon(pts, fill=(38, 30, 16, 255))
    d.line(pts + [pts[0]], fill=GOLD + (255,), width=5, joint="curve")
    d.line([(cx - s * 0.36, cy + s * 0.02), (cx - s * 0.08, cy + s * 0.32),
            (cx + s * 0.42, cy - s * 0.30)], fill=GOLD + (255,), width=int(s * 0.16),
           joint="curve")


def lock(d, cx, cy, s, col):
    d.arc([cx - s * 0.52, cy - s * 1.25, cx + s * 0.52, cy - s * 0.15], 180, 360,
          fill=col + (255,), width=int(s * 0.18))
    d.line([(cx - s * 0.43, cy - s * 0.7), (cx - s * 0.43, cy - s * 0.2)], fill=col + (255,),
           width=int(s * 0.18))
    d.line([(cx + s * 0.43, cy - s * 0.7), (cx + s * 0.43, cy - s * 0.2)], fill=col + (255,),
           width=int(s * 0.18))
    d.rounded_rectangle([cx - s * 0.78, cy - s * 0.3, cx + s * 0.78, cy + s * 0.78],
                        radius=int(s * 0.18), fill=(40, 20, 26, 255), outline=col + (255,),
                        width=4)
    d.ellipse([cx - s * 0.13, cy + s * 0.08, cx + s * 0.13, cy + s * 0.34], fill=col + (255,))


def bezier(p0, p1, p2, n=60):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
    return out


def dotted(d, pts, col, every=3, r=4, fade=(90, 255)):
    for i, (x, y) in enumerate(pts):
        if i % every:
            continue
        a = int(fade[0] + (fade[1] - fade[0]) * i / max(1, len(pts) - 1))
        d.ellipse([x - r, y - r, x + r, y + r], fill=col + (a,))


def arrow_head(d, tip, frm, col, s=18):
    ang = math.atan2(tip[1] - frm[1], tip[0] - frm[0])
    pts = [tip,
           (tip[0] - s * math.cos(ang - 0.45), tip[1] - s * math.sin(ang - 0.45)),
           (tip[0] - s * math.cos(ang + 0.45), tip[1] - s * math.sin(ang + 0.45))]
    d.polygon(pts, fill=col + (255,))


def vignette(img):
    """Fade the frame's edges into the page colour so the scene has no hard border."""
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rounded_rectangle([W * 0.07, H * 0.09, W * 0.93, H * 0.91],
                                        radius=260, fill=255)
    m = m.filter(ImageFilter.GaussianBlur(110))
    base = Image.new("RGBA", (W, H), PAGE_BG + (255,))
    return Image.composite(img, base, m)


def render():
    bg = glow((W, H), [
        (W * 0.36, H * 0.52, W * 0.40, (24, 66, 158), 0.52),
        (W * 0.78, H * 0.50, W * 0.26, (10, 92, 116), 0.34),
        (W * 0.80, H * 0.30, W * 0.14, (110, 84, 36), 0.20),
    ], base=PAGE_BG).convert("RGBA")

    # Perspective floor.
    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)
    hy = H * 0.66
    for i in range(-10, 24):
        d.line([W * 0.55, hy, W * 0.55 + i * W * 0.09, H], fill=BLUE + (20,), width=2)
    for i in range(1, 11):
        t = i / 10
        y = hy + (H - hy) * (t ** 2.0)
        d.line([0, y, W, y], fill=BLUE + (int(26 * t) + 6,), width=2)
    net_lines(d, W, H, [(int(W * 0.06), int(H * 0.14)), (int(W * 0.17), int(H * 0.07)),
                        (int(W * 0.10), int(H * 0.32)), (int(W * 0.94), int(H * 0.10)),
                        (int(W * 0.86), int(H * 0.05))], CYAN, 40)
    bg.alpha_composite(fx)
    bg = vignette(bg)

    # Server block with verification shield (right).
    sv = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sv)
    scx, sbase = 1220, 800
    sd.ellipse([scx - 170, sbase - 40, scx + 230, sbase + 50], fill=(0, 0, 0, 150))
    sv = sv.filter(ImageFilter.GaussianBlur(22))
    sd = ImageDraw.Draw(sv)
    iso_server(sd, scx, sbase, 220, 250, 120)
    bg.alpha_composite(sv)

    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    shx, shy = 1262, 318
    hd.ellipse([shx - 120, shy - 120, shx + 120, shy + 120], fill=GOLD + (70,))
    bg.alpha_composite(halo.filter(ImageFilter.GaussianBlur(48)))
    fg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fg)
    # Beam from the server top to the shield.
    fd.line([(shx, 492), (shx, shy + 142)], fill=GOLD + (120,), width=3)
    fd.line([(shx, shy + 92), (shx, shy + 100)], fill=GOLD + (120,), width=3)
    fd.ellipse([shx - 92, shy - 92, shx + 92, shy + 92], outline=GOLD + (70,), width=2)
    shield(fd, shx, shy, 62)
    f_lbl = ImageFont.truetype(FONT_B, 22)
    txt = "verified"
    tw = fd.textlength(txt, font=f_lbl)
    fd.text((shx - tw / 2, shy + 104), txt, font=f_lbl, fill=GOLD + (235,))
    bg.alpha_composite(fg)

    # The invoice card (left), tilted so it faces the server.
    card = invoice_card(900)
    cw, ch = card.size
    k = 1.0
    x0, y0 = 220, 58
    quad = [(x0, y0 + 26), (x0 + cw * 0.93 * k, y0), (x0 + cw * 0.93 * k, y0 + ch * 0.985),
            (x0, y0 + ch * 0.985 - 20)]
    warped = warp_to(card, quad, (W, H))
    shadow = warped.split()[3].filter(ImageFilter.GaussianBlur(34)).point(lambda v: v * 150 // 255)
    sh_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sh_img.putalpha(shadow)
    bg.alpha_composite(sh_img, (22, 30))
    # Rim light behind the card.
    rim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(rim).polygon(quad, fill=CYAN + (60,))
    bg.alpha_composite(rim.filter(ImageFilter.GaussianBlur(30)))
    bg.alpha_composite(warped)

    # Two concurrent confirmations. The invoice block on the card sits near its
    # bottom; the landing arrow targets its right edge.
    right_x = quad[1][0]
    land = (right_x + 14, 800)
    blocked = (1000, 575)
    src = (scx - 80, sbase - 170)

    ar = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ad = ImageDraw.Draw(ar)
    p_ok = bezier((src[0] - 30, src[1] + 60), (1060, 860), land)
    p_no = bezier((src[0] - 30, src[1] - 20), (1110, 540), blocked)
    for width, a in ((16, 34), (8, 70)):
        ad.line(p_ok, fill=GREEN + (a,), width=width, joint="curve")
        ad.line(p_no, fill=RED + (a // 2,), width=width, joint="curve")
    bg.alpha_composite(ar.filter(ImageFilter.GaussianBlur(4)))
    ad = ImageDraw.Draw(bg)
    ad.line(p_ok, fill=GREEN + (230,), width=3, joint="curve")
    arrow_head(ad, land, p_ok[-4], GREEN, 22)
    dotted(ad, p_no, (200, 110, 120), every=4, r=3, fade=(200, 110))
    # Lock where the duplicate stops.
    lg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(lg).ellipse([blocked[0] - 64, blocked[1] - 64, blocked[0] + 64,
                                blocked[1] + 64], fill=RED + (70,))
    bg.alpha_composite(lg.filter(ImageFilter.GaussianBlur(26)))
    ad = ImageDraw.Draw(bg)
    lock(ad, blocked[0] + 8, blocked[1] + 6, 38, RED)
    f_sm = ImageFont.truetype(FONT, 20)
    for label, (lx, ly), col in (("paid once", (land[0] + 26, land[1] + 20), GREEN),
                                 ("duplicate", (blocked[0] - 36, blocked[1] + 58), RED)):
        ad.text((lx, ly), label, font=f_sm, fill=col + (220,))

    return save(bg, "16-payment")


if __name__ == "__main__":
    render()
