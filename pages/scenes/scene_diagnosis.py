"""
Stage scene: Diagnosis, labelled (shot 04-ai-diagnosis).

The real diagnosis screen in a tilted phone, beside a stack of translucent rule
cards floating in depth. The diagnosis comes from a deterministic rule table,
not a model, so the scene shows exactly that: rows of IF symptom / THEN cause,
one rule lit gold as the match, wired back to the rules-1.0.0 label on screen.

    python pages/scenes/scene_diagnosis.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import *  # noqa: E402,F401,F403
from scene_home import build_phone, ground  # noqa: E402

from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

SHOT = "04-ai-diagnosis"
FONT = "C:/Windows/Fonts/segoeui.ttf"
FONT_B = "C:/Windows/Fonts/segoeuib.ttf"

CW, CH = 1040, 560  # flat card size, drawn at 2x and warped down


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def card_face(matched):
    """One rule card drawn flat. Only true labels: rules-1.0.0, IF symptom,
    THEN cause, confidence."""
    img = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    accent = GOLD if matched else CYAN
    fill = (34, 28, 16, 215) if matched else (14, 24, 40, 150)
    d.rounded_rectangle([0, 0, CW - 1, CH - 1], radius=48, fill=fill,
                        outline=accent + (255 if matched else 150,), width=6)
    d.rounded_rectangle([10, 10, CW - 11, CH - 11], radius=40,
                        outline=accent + (50,), width=2)
    small, label = font(FONT_B, 44), font(FONT_B, 52)
    mute = (150, 165, 190)
    # Header: the engine label.
    d.text((64, 50), "rules-1.0.0", font=small,
           fill=(GOLD if matched else mute) + (255 if matched else 190,))
    d.line([64, 132, CW - 64, 132], fill=accent + (70,), width=3)
    rows = [("IF symptom", 0.62), ("THEN cause", 0.48)]
    y = 170
    for text, frac in rows:
        if matched:
            d.text((64, y), text, font=label, fill=(245, 240, 228, 255))
            x0 = 420
        else:
            d.rounded_rectangle([64, y + 18, 300, y + 44], radius=13, fill=mute + (110,))
            x0 = 360
        d.rounded_rectangle([x0, y + 18, x0 + (CW - 64 - x0) * frac + 120, y + 44],
                            radius=13, fill=accent + (150 if matched else 70,))
        y += 110
    # Confidence row with a bar.
    if matched:
        d.text((64, y), "confidence", font=label, fill=(245, 240, 228, 255))
        bx = 420
    else:
        d.rounded_rectangle([64, y + 18, 300, y + 44], radius=13, fill=mute + (110,))
        bx = 360
    d.rounded_rectangle([bx, y + 20, CW - 64, y + 44], radius=12, fill=(60, 66, 84, 200))
    d.rounded_rectangle([bx, y + 20, bx + (CW - 64 - bx) * (0.8 if matched else 0.45),
                         y + 44], radius=12, fill=accent + (255 if matched else 110,))
    return img


def quad(x, y, w):
    """Screen quad for a card lying in a receding, slightly upturned plane."""
    h = w * CH / CW
    return [(x, y), (x + w * 0.92, y - w * 0.26),
            (x + w * 0.92 + h * 0.34, y - w * 0.26 + h * 0.62), (x + h * 0.34, y + h * 0.62)]


def place(layer, face, q, fade=1.0):
    coeffs = perspective_coeffs([(0, 0), (CW, 0), (CW, CH), (0, CH)], q)
    warped = face.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    if fade < 1.0:
        warped.putalpha(warped.split()[3].point(lambda v: int(v * fade)))
    layer.alpha_composite(warped)


def render():
    bg = glow((W, H), [
        (W * 0.32, H * 0.55, W * 0.36, (22, 62, 150), 0.55),
        (W * 0.74, H * 0.40, W * 0.32, (14, 80, 110), 0.34),
        (W * 0.70, H * 0.62, W * 0.20, (110, 84, 36), 0.30),
    ], base=PAGE_BG).convert("RGBA")

    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fx)
    ground(d, (W * 0.55, H * 0.66), BLUE, strength=0.9, spread=0.10)
    net_lines(d, W, H, [(int(W * 0.06), int(H * 0.12)), (int(W * 0.18), int(H * 0.05)),
                        (int(W * 0.94), int(H * 0.08)), (int(W * 0.86), int(H * 0.03))],
              CYAN, 40)
    bg.alpha_composite(fx)

    phone, to_img, box = build_phone(SHOT, int(H * 0.88), lean=0.14)
    px = int(W * 0.29 - (box[0] + box[2]) / 2)
    py = int(H * 0.5 - (box[1] + box[3]) / 2)
    chip = to_img(305, 478)          # just right of the RULES-1.0.0 chip
    chip = (chip[0] + px, chip[1] + py)
    right_edge = box[2] + px

    # Stack of rule cards in depth: back to front. Index 1 is the match.
    cw = 470
    stack = [(W * 0.605, H * 0.30), (W * 0.585, H * 0.47), (W * 0.605, H * 0.64),
             (W * 0.625, H * 0.81)]
    matched = 1
    quads = [quad(x, y, cw) for x, y in stack]
    # Pull the matched card out towards the phone.
    mq = quad(stack[matched][0] - 70, stack[matched][1] + 10, cw * 1.04)
    quads[matched] = mq

    # Card shadows on the ground plane and a gold glow under the match.
    under = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ud = ImageDraw.Draw(under)
    ud.polygon(mq, fill=GOLD + (90,))
    bg.alpha_composite(under.filter(ImageFilter.GaussianBlur(60)))

    # Wires from the phone to every rule; the matched one is bright gold.
    wires = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wires)
    for i, q in enumerate(quads):
        if i == matched:
            continue
        a = (right_edge - 6, chip[1] + (i - matched) * 40)
        b = q[0]
        wd.line([a, b], fill=CYAN + (70,), width=2)
        wd.ellipse([b[0] - 5, b[1] - 5, b[0] + 5, b[1] + 5], fill=CYAN + (170,))

    cards = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    faces = {False: card_face(False), True: card_face(True)}
    for i, q in enumerate(quads):
        if i == matched:
            continue
        place(cards, faces[False], q, fade=0.75 + 0.08 * i)
    # Matched card drawn last so it sits in front of its neighbours.
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    place(halo, faces[True], mq)
    glow_m = halo.filter(ImageFilter.GaussianBlur(22))
    cards.alpha_composite(glow_m)
    cards.alpha_composite(halo)

    # Gold wire from the on-screen rules label to the matched card.
    gw = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gw)
    end = mq[0]
    start = chip
    for wdt, a in ((12, 50), (3, 235)):
        gd.line([start, ((start[0] + end[0]) / 2, start[1] - 10), end],
                fill=GOLD + (a,), width=wdt, joint="curve")
    for pt in (start, end):
        gd.ellipse([pt[0] - 8, pt[1] - 8, pt[0] + 8, pt[1] + 8], fill=GOLD + (255,))
        gd.ellipse([pt[0] - 16, pt[1] - 16, pt[0] + 16, pt[1] + 16], outline=GOLD + (120,),
                   width=2)

    bg.alpha_composite(wires)
    bg.alpha_composite(cards)

    edge = Image.new("L", (W, H), 255)
    ImageDraw.Draw(edge).rounded_rectangle([90, 70, W - 90, H - 70], radius=120, fill=0)
    edge = edge.filter(ImageFilter.GaussianBlur(70))
    bg = Image.composite(Image.new("RGBA", (W, H), PAGE_BG + (255,)), bg, edge)

    bg.alpha_composite(phone, (px, py))
    bg.alpha_composite(gw)
    return save(bg, SHOT)


if __name__ == "__main__":
    render()
