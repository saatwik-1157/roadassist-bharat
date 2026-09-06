"""
ROADASSIST NEXUS — SWE4004 Cloud Computing presentation builder.

Generates a 16:9 .pptx in which RoadAssist Bharat is the worked example used to
demonstrate Modules 1-4, rather than a project deck with cloud theory bolted on.

Every technical claim is tagged with one of three honesty badges:

  IMPLEMENTED           verified present in this repository
  ARCHITECTURAL CONCEPT the textbook mechanism, mapped onto the design
  PROPOSED              future scope, explicitly not built

Nothing is asserted about Kubernetes, AWS/Azure/GCP, autoscaling, uptime,
user counts or AI accuracy, because none of those exist in the project.

    python ppt/build_deck.py
"""
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

OUT = Path(__file__).resolve().parent
ASSETS = OUT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

# ── palette ──────────────────────────────────────────────────────────────────
INK        = RGBColor(0x07, 0x0B, 0x14)   # near-black navy ground
INK_2      = RGBColor(0x0C, 0x13, 0x22)   # panel fill
INK_3      = RGBColor(0x13, 0x1D, 0x30)   # raised panel
BLUE       = RGBColor(0x2E, 0x7D, 0xFF)   # electric blue, primary
CYAN       = RGBColor(0x22, 0xD3, 0xEE)   # secondary
RED        = RGBColor(0xFF, 0x4D, 0x5E)   # emergency, used sparingly
GREEN      = RGBColor(0x34, 0xD3, 0x99)   # success
AMBER      = RGBColor(0xF5, 0xB1, 0x4C)   # caution
WHITE      = RGBColor(0xF4, 0xF7, 0xFB)
GREY       = RGBColor(0x93, 0xA1, 0xB5)   # cool grey body
GREY_DIM   = RGBColor(0x5C, 0x6B, 0x80)
LINE       = RGBColor(0x1E, 0x2C, 0x45)

SANS = "Segoe UI"
SANS_LIGHT = "Segoe UI Light"
SANS_SEMI = "Segoe UI Semibold"
MONO = "Consolas"

W, H = Inches(13.333), Inches(7.5)

# Honesty badges — the academic requirement.
IMPL = ("IMPLEMENTED", GREEN)
ARCH = ("ARCHITECTURAL CONCEPT", CYAN)
PROP = ("PROPOSED / FUTURE SCOPE", AMBER)
PART = ("PARTIALLY IMPLEMENTED", AMBER)


# ── raster backgrounds (Pillow) ──────────────────────────────────────────────
def _rgb(c):
    return (c[0], c[1], c[2]) if isinstance(c, tuple) else (c >> 16 & 255, c >> 8 & 255, c & 255)


def make_bg(name, glows, base=(5, 8, 14), vignette=True, grid=True):
    """A dark navy ground with soft coloured glows — the deck's atmosphere.

    Rendered once at 2x and downsampled so the gradients stay smooth on a
    projector instead of banding.
    """
    path = ASSETS / f"{name}.png"
    if path.exists():
        return str(path)
    w, h = 2560, 1440
    img = Image.new("RGB", (w, h), base)

    # Soft radial glows, blurred then added at C speed (ImageChops), never with
    # a per-pixel Python loop — that is 3.7M iterations per layer.
    glow_layer = Image.new("RGB", (w, h), (0, 0, 0))
    gd = ImageDraw.Draw(glow_layer)
    for (cx, cy, r, colour, strength) in glows:
        col = tuple(int(c * strength) for c in colour)
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=260))
    img = ImageChops.add(img, glow_layer)

    if grid:
        # A faint technical grid, well under the glow so it reads as texture.
        gl = Image.new("RGB", (w, h), (0, 0, 0))
        gdr = ImageDraw.Draw(gl)
        step = 96
        for x in range(0, w, step):
            gdr.line([(x, 0), (x, h)], fill=(7, 12, 21), width=2)
        for y in range(0, h, step):
            gdr.line([(0, y), (w, y)], fill=(7, 12, 21), width=2)
        img = ImageChops.add(img, gl)

    if vignette:
        vg = Image.new("L", (w, h), 0)
        vd = ImageDraw.Draw(vg)
        vd.ellipse([w * 0.02, -h * 0.10, w * 0.98, h * 1.10], fill=255)
        vg = vg.filter(ImageFilter.GaussianBlur(radius=300))
        black = Image.new("RGB", (w, h), (3, 5, 10))
        img = Image.composite(img, black, vg)

    img = img.resize((1920, 1080), Image.LANCZOS)
    img.save(path, "PNG", optimize=True)
    return str(path)


BG_HERO = make_bg("bg_hero", [
    (1980, 1010, 620, (22, 62, 150), 0.34),
    (2300, 540, 450, (10, 92, 116), 0.24),
    (430, 1240, 460, (58, 18, 38), 0.16),
])
BG_DEEP = make_bg("bg_deep", [
    (250, 210, 540, (18, 52, 122), 0.24),
    (2340, 1240, 540, (10, 86, 108), 0.18),
])
BG_MOD = make_bg("bg_mod", [
    (1280, 120, 640, (20, 60, 140), 0.22),
    (1280, 1360, 600, (10, 80, 104), 0.14),
])
BG_RED = make_bg("bg_red", [
    (2050, 1180, 540, (118, 26, 44), 0.24),
    (420, 240, 480, (18, 52, 122), 0.18),
])
BG_CLEAN = make_bg("bg_clean", [
    (1280, 780, 760, (14, 44, 104), 0.18),
])


# ── slide primitives ─────────────────────────────────────────────────────────
prs = Presentation()
prs.slide_width, prs.slide_height = W, H
BLANK = prs.slide_layouts[6]

DECK = []          # (slide, notes) for a final pass


def new_slide(bg=BG_DEEP):
    s = prs.slides.add_slide(BLANK)
    s.shapes.add_picture(bg, 0, 0, width=W, height=H)
    return s


def txt(slide, x, y, w, h, text, size=18, color=GREY, bold=False, font=SANS,
        align=PP_ALIGN.LEFT, spacing=0.0, line=1.25, anchor=MSO_ANCHOR.TOP,
        caps=False, italic=False):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    lines = text.split("\n")
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line
        r = p.add_run()
        r.text = ln.upper() if caps else ln
        f = r.font
        f.name = font
        f.size = Pt(size)
        f.bold = bold
        f.italic = italic
        f.color.rgb = color
        if spacing:
            # python-pptx has no letter-spacing API; set it on the rPr directly.
            r._r.get_or_add_rPr().set("spc", str(int(spacing * 100)))
    return box


def panel(slide, x, y, w, h, fill=INK_2, line_col=LINE, radius=0.035, alpha=None,
          line_w=1.0):
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                Inches(x), Inches(y), Inches(w), Inches(h))
    sh.adjustments[0] = radius
    sh.fill.solid()
    sh.fill.fore_color.rgb = fill
    if alpha is not None:
        # Soft panels read better than opaque blocks over a glow.
        from pptx.oxml.ns import qn
        sp = sh.fill.fore_color._xFill.find(qn("a:srgbClr"))
        el = sp.makeelement(qn("a:alpha"), {"val": str(int(alpha * 100000))})
        sp.append(el)
    if line_col is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line_col
        sh.line.width = Pt(line_w)
    sh.shadow.inherit = False
    return sh


def chip(slide, x, y, w, h, label, color=CYAN, size=10.5, fill=INK_3, bold=True):
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                Inches(x), Inches(y), Inches(w), Inches(h))
    sh.adjustments[0] = 0.5
    sh.fill.solid()
    sh.fill.fore_color.rgb = fill
    sh.line.color.rgb = color
    sh.line.width = Pt(0.9)
    sh.shadow.inherit = False
    tf = sh.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.06)
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.name = SANS
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.color.rgb = color
    return sh


def node(slide, x, y, w, h, title, sub=None, color=BLUE, tsize=12.5, ssize=9.5):
    """A labelled block in a diagram — the deck's main structural unit."""
    sh = panel(slide, x, y, w, h, fill=INK_2, line_col=color, line_w=1.25)
    tf = sh.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.08)
    tf.margin_top = tf.margin_bottom = Inches(0.04)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = title
    r.font.name = SANS_SEMI
    r.font.size = Pt(tsize)
    r.font.bold = True
    r.font.color.rgb = WHITE
    if sub:
        p2 = tf.add_paragraph()
        p2.alignment = PP_ALIGN.CENTER
        p2.line_spacing = 1.1
        r2 = p2.add_run()
        r2.text = sub
        r2.font.name = SANS
        r2.font.size = Pt(ssize)
        r2.font.color.rgb = GREY
    return sh


def arrow(slide, x1, y1, x2, y2, color=CYAN, width=1.4, dashed=False):
    from pptx.enum.shapes import MSO_CONNECTOR
    cn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,
                                    Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    cn.line.color.rgb = color
    cn.line.width = Pt(width)
    if dashed:
        from pptx.oxml.ns import qn
        ln = cn.line._get_or_add_ln()
        d = ln.makeelement(qn("a:prstDash"), {"val": "dash"})
        ln.append(d)
    # arrow head
    from pptx.oxml.ns import qn
    ln = cn.line._get_or_add_ln()
    head = ln.makeelement(qn("a:tailEnd"), {"type": "triangle", "w": "sm", "len": "sm"})
    ln.append(head)
    return cn


def down_arrow(slide, cx, y, h=0.3, color=CYAN):
    arrow(slide, cx, y, cx, y + h, color=color)


def title_block(slide, title, eyebrow=None, badge=None, y=0.82, size=34,
                sub=None, width=11.6):
    if eyebrow:
        txt(slide, 0.85, y - 0.32, width, 0.3, eyebrow, size=11, color=CYAN,
            bold=True, spacing=2.6, caps=True, font=SANS)
    txt(slide, 0.85, y, width, 1.0, title, size=size, color=WHITE, bold=True,
        font=SANS_SEMI, line=1.02)
    if sub:
        txt(slide, 0.85, y + (0.62 if size >= 30 else 0.5), width, 0.5, sub,
            size=13.5, color=GREY, font=SANS, line=1.3)
    if badge:
        label, col = badge
        chip(slide, 13.333 - 0.85 - 2.55, y - 0.28, 2.55, 0.3, label, color=col, size=9)


def module_rail(slide, active):
    """A persistent 1-2-3-4 rail so the evaluator always knows where they are."""
    labels = ["M1 · UNDERSTANDING", "M2 · ENABLING TECH",
              "M3 · INFRASTRUCTURE", "M4 · ARCHITECTURES"]
    x = 0.85
    for i, lab in enumerate(labels, start=1):
        on = (i == active)
        sh = chip(slide, x, 6.86, 2.62, 0.3, lab,
                  color=(CYAN if on else GREY_DIM),
                  fill=(INK_3 if on else INK), size=8.5, bold=on)
        x += 2.78


def footer(slide, text="ROADASSIST BHARAT · SWE4004 CLOUD COMPUTING AND APPLICATIONS"):
    txt(slide, 0.85, 6.98, 9.0, 0.28, text, size=8, color=GREY_DIM,
        spacing=2.0, caps=True)


def page_no(slide, n=None):
    """Stamp the slide's real position.

    The number is derived from how many slides exist at the moment it is called
    — which, since each slide stamps itself as it is built, is its own index.
    The `n` argument is ignored and kept only so existing calls still read
    naturally; hard-coded numbers silently rot the moment a slide is inserted.
    """
    idx = len(prs.slides._sldIdLst)
    txt(slide, 12.2, 6.98, 0.5, 0.28, f"{idx:02d}", size=9, color=GREY_DIM,
        align=PP_ALIGN.RIGHT, font=MONO)


def visual_slot(slide, x, y, w, h, caption, prompt):
    """A deliberate, designed placeholder for a 3D render.

    The deck ships complete and presentable without any external artwork; this
    marks where a photorealistic render belongs and carries the exact prompt in
    the shape itself, so dropping one in is a right-click away.
    """
    sh = panel(slide, x, y, w, h, fill=INK_2, line_col=BLUE, line_w=1.0)
    from pptx.oxml.ns import qn
    ln = sh.line._get_or_add_ln()
    ln.append(ln.makeelement(qn("a:prstDash"), {"val": "dash"}))
    txt(slide, x + 0.3, y + h / 2 - 0.55, w - 0.6, 0.3, "3D VISUAL SLOT",
        size=9.5, color=BLUE, bold=True, spacing=2.4, align=PP_ALIGN.CENTER)
    txt(slide, x + 0.3, y + h / 2 - 0.22, w - 0.6, 0.45, caption,
        size=13, color=WHITE, bold=True, align=PP_ALIGN.CENTER, font=SANS_SEMI)
    txt(slide, x + 0.35, y + h / 2 + 0.22, w - 0.7, 0.8,
        f"Right-click → Change Picture. Prompt: {prompt}",
        size=8.5, color=GREY_DIM, align=PP_ALIGN.CENTER, line=1.25)
    return sh


def fit_crop(src, ratio, tag):
    """Centre-crop an image to a target aspect so add_picture never stretches it."""
    from PIL import Image as _Im
    out = ASSETS / f"_fit_{tag}.png"
    im = _Im.open(src)
    have = im.width / im.height
    if abs(have - ratio) > 0.01:
        if have > ratio:                      # too wide — trim the sides
            nw = int(im.height * ratio)
            x0 = (im.width - nw) // 2
            im = im.crop((x0, 0, x0 + nw, im.height))
        else:                                 # too tall — trim top and bottom
            nh = int(im.width / ratio)
            y0 = (im.height - nh) // 2
            im = im.crop((0, y0, im.width, y0 + nh))
    im.save(out, "PNG", optimize=True)
    return str(out)


def visual(slide, x, y, w, h, src, tag, border=True):
    """Place a rendered visual, cropped to the slot rather than distorted."""
    slide.shapes.add_picture(fit_crop(src, w / h, tag),
                             Inches(x), Inches(y), Inches(w), Inches(h))
    if border:
        fr = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                    Inches(x), Inches(y), Inches(w), Inches(h))
        fr.adjustments[0] = 0.02
        fr.fill.background()
        fr.line.color.rgb = LINE
        fr.line.width = Pt(1.0)
        fr.shadow.inherit = False


def notes(slide, body):
    slide.notes_slide.notes_text_frame.text = body


def transition(slide, kind="fade", ms=700):
    """Attach a slide transition.

    python-pptx exposes no transition API, so the element is written into the
    slide XML directly. Morph is used only where consecutive slides share
    shapes — it interpolates between them, which is what makes an architecture
    diagram appear to assemble rather than cut.
    """
    # Slides are freshly created here, so there is no prior transition to strip.
    sld = slide._element
    p14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"
    p159 = "http://schemas.microsoft.com/office/powerpoint/2015/09/main"
    mc = "http://schemas.openxmlformats.org/markup-compatibility/2006"
    a = "http://schemas.openxmlformats.org/drawingml/2006/main"
    pns = "http://schemas.openxmlformats.org/presentationml/2006/main"

    alt = sld.makeelement("{%s}AlternateContent" % mc, {})
    alt.set("{http://www.w3.org/2000/xmlns/}mc", mc)
    choice = alt.makeelement("{%s}Choice" % mc,
                             {"Requires": "p159" if kind == "morph" else "p14"})
    choice.set("{http://www.w3.org/2000/xmlns/}p159", p159)
    choice.set("{http://www.w3.org/2000/xmlns/}p14", p14)
    tr = choice.makeelement("{%s}transition" % pns,
                            {"spd": "slow", "{%s}dur" % p14: str(ms)})
    if kind == "morph":
        tr.append(tr.makeelement("{%s}morph" % p159, {"option": "byObject"}))
    else:
        tr.append(tr.makeelement("{%s}fade" % pns, {}))
    choice.append(tr)
    alt.append(choice)

    fb = alt.makeelement("{%s}Fallback" % mc, {})
    tr2 = fb.makeelement("{%s}transition" % pns, {"spd": "slow"})
    tr2.append(tr2.makeelement("{%s}fade" % pns, {}))
    fb.append(tr2)
    alt.append(fb)
    sld.append(alt)
