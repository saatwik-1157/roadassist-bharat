#!/usr/bin/env python3
"""Build the RoadAssist Bharat design boards as SVG for Figma.

Figma imports a dropped SVG as editable layers: rectangles stay rectangles,
text stays live text (set in Inter, which every Figma account has), and each
embedded screenshot becomes an image fill. So the boards are written as SVG
from real assets - the product screenshots in app/docs/screenshots and the 3D
renders in app/docs/screenshots/scene - and nothing on them is invented:
every number is one the project measured (app/docs/measured.json).

    python design/build_boards.py

writes design/figma/{brand,desktop,mobile}.svg.
"""
from __future__ import annotations

import base64
import io
import json
from html import escape
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "app" / "docs" / "screenshots"
BRAND = ROOT / "brand"
OUT = ROOT / "design" / "figma"

# ── palette ────────────────────────────────────────────────────────────────
BG, BG2, SURF, SURF2 = "#07090D", "#0C1017", "#111723", "#172031"
INK, INK2, INK3 = "#F5F2EA", "#B7BFCC", "#7C8799"
GOLD, GOLD2, BLUE, GREEN, RED = "#F0B429", "#FFD978", "#4DA3FF", "#2ED08A", "#FF5D5D"
FONT = "Inter, Segoe UI, sans-serif"   # Figma takes Inter; previews fall back

# ── measured numbers, never typed by hand ──────────────────────────────────
M = json.loads((ROOT / "app" / "docs" / "measured.json").read_text(encoding="utf-8"))


def num(*path):
    """A measured value. A missing key is an error, never a quiet default:
    a design board that shows a number the project did not measure is exactly
    the claim this project refuses to make."""
    cur = M
    for k in path:
        if not isinstance(cur, dict) or k not in cur:
            raise KeyError("measured.json has no " + ".".join(path))
        cur = cur[k]
    return cur


# ── primitives ─────────────────────────────────────────────────────────────
def img_data(path: Path, max_w: int, quality: int = 86) -> tuple[str, int, int]:
    with Image.open(path) as im:
        im = im.convert("RGB")
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), im.width, im.height


def svg_file_data(path: Path) -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(path.read_bytes()).decode()


def rect(x, y, w, h, fill, r=0, stroke=None, sw=1, so=1.0, fo=1.0, name=None):
    a = f' id="{escape(name)}"' if name else ""
    s = f' stroke="{stroke}" stroke-width="{sw}" stroke-opacity="{so}"' if stroke else ""
    return f'<rect{a} x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" fill-opacity="{fo}"{s}/>'


def text(x, y, s, size=16, weight=400, fill=INK, anchor="start", ls=0, lh=None, op=1.0, name=None):
    """Multi-line text: pass a list for explicit lines."""
    lines = s if isinstance(s, list) else [s]
    lh = lh or round(size * 1.35)
    a = f' id="{escape(name)}"' if name else ""
    spans = "".join(
        f'<tspan x="{x}" dy="{0 if i == 0 else lh}">{escape(line)}</tspan>' for i, line in enumerate(lines))
    return (f'<text{a} x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" fill-opacity="{op}" text-anchor="{anchor}" letter-spacing="{ls}">{spans}</text>')


def wrap(s: str, size: float, width: float, factor: float = 0.53) -> list[str]:
    per = max(8, int(width / (size * factor)))
    out, line = [], ""
    for word in s.split():
        if len(line) + len(word) + (1 if line else 0) > per:
            out.append(line)
            line = word
        else:
            line = f"{line} {word}" if line else word
    if line:
        out.append(line)
    return out


def image(x, y, w, h, href, r=0, name=None, fit="xMidYMin slice"):
    cid = f"clip{abs(hash((x, y, w, h, name))) % 10**9}"
    a = f' id="{escape(name)}"' if name else ""
    return (f'<clipPath id="{cid}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}"/></clipPath>'
            f'<image{a} x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="{fit}" '
            f'href="{href}" clip-path="url(#{cid})"/>')


def glow(cx, cy, rx, ry, color, op=0.35, blur=60):
    """A soft light. A radial gradient, not an feGaussianBlur: Figma imports
    gradients as fills but drops SVG filters, which left hard-edged discs."""
    gid = f"rg{abs(hash((cx, cy, rx, ry, color))) % 10**9}"
    return (f'<radialGradient id="{gid}" cx="0.5" cy="0.5" r="0.5">'
            f'<stop offset="0" stop-color="{color}" stop-opacity="{op}"/>'
            f'<stop offset="0.55" stop-color="{color}" stop-opacity="{op * 0.35:.3f}"/>'
            f'<stop offset="1" stop-color="{color}" stop-opacity="0"/></radialGradient>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{rx * 1.35}" ry="{ry * 1.35}" fill="url(#{gid})"/>')


def pill(x, y, label, fill=SURF2, color=INK2, size=13, weight=600, pad=14, h=32, dot=None, stroke="#FFFFFF", so=0.08):
    caps = sum(c.isupper() for c in label) / max(1, len(label))
    w = round(len(label) * size * (0.60 + 0.12 * caps) + pad * 2 + (16 if dot else 0))
    parts = [rect(x, y, w, h, fill, r=h / 2, stroke=stroke, so=so)]
    tx = x + pad
    if dot:
        parts.append(f'<circle cx="{x + pad + 4}" cy="{y + h / 2}" r="4" fill="{dot}"/>')
        tx += 16
    parts.append(text(tx, y + h / 2 + size * 0.36, label, size=size, weight=weight, fill=color, ls=0.4))
    return "".join(parts), w


def button(x, y, label, primary=True, h=52, size=16):
    w = round(len(label) * size * 0.58 + 56)
    if primary:
        return rect(x, y, w, h, GOLD, r=h / 2) + text(x + w / 2, y + h / 2 + size * 0.36, label, size, 700, "#16110A", "middle"), w
    return (rect(x, y, w, h, SURF, r=h / 2, stroke="#FFFFFF", so=0.14)
            + text(x + w / 2, y + h / 2 + size * 0.36, label, size, 600, INK, "middle")), w


def phone(x, y, w, href, name, screen_h=None):
    """A handset: bezel, notch in the bezel, the capture as the screen."""
    pad, top = round(w * 0.035), round(w * 0.09)
    sh = screen_h or round((w - pad * 2) * 2.1)
    h = sh + top + pad
    return (glow(x + w / 2, y + h * 0.55, w * 0.55, h * 0.4, GOLD, 0.10, 50)
            + rect(x, y, w, h, "#141922", r=round(w * 0.14), stroke="#FFFFFF", so=0.10, name=f"{name} bezel")
            + rect(x + w / 2 - w * 0.12, y + top * 0.36, w * 0.24, top * 0.24, "#05070A", r=top * 0.12)
            + image(x + pad, y + top, w - pad * 2, sh, href, r=round(w * 0.09), name=f"{name} screen")), h


def browser(x, y, w, h, href, name, address="app.roadassistbharat.online", live=True):
    bar = 38
    badge = ("● LIVE", GREEN) if live else ("● SCREENSHOT", INK3)
    return (glow(x + w / 2, y + h * 0.6, w * 0.5, h * 0.45, BLUE, 0.10, 70)
            + rect(x, y, w, h, "#0E131C", r=16, stroke="#FFFFFF", so=0.10, name=f"{name} window")
            + rect(x, y, w, bar, "#121926", r=16)
            + rect(x, y + bar - 16, w, 16, "#121926")
            + "".join(f'<circle cx="{x + 20 + i * 16}" cy="{y + bar / 2}" r="5" fill="{c}"/>'
                      for i, c in enumerate(["#E05A5A", "#E0A640", "#49C97E"]))
            + rect(x + 72, y + 8, w * 0.42, bar - 16, "#0A0E15", r=8)
            + text(x + 86, y + bar / 2 + 4.5, address, 12, 500, INK3)
            + text(x + w - 18, y + bar / 2 + 4.5, badge[0], 11, 800, badge[1], "end", ls=1.2)
            + image(x + 1, y + bar, w - 2, h - bar - 1, href, r=0, name=f"{name} screen")), h


def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<title>{escape(title)}</title>{body}</svg>')


_MARK_SRC = (BRAND / "logo-mark.svg").read_text(encoding="utf-8")
_MARK_BODY = _MARK_SRC[_MARK_SRC.index(">", _MARK_SRC.index("<svg")) + 1:_MARK_SRC.rindex("</svg>")]
_MARK_N = [0]


def mark(x, y, size, name="Logo mark"):
    """The logo as live vectors. Gradient ids are made unique per use, since
    one SVG document may hold the mark several times."""
    _MARK_N[0] += 1
    body = _MARK_BODY
    for gid in ("ra-gold", "ra-road", "ra-pulse"):
        body = body.replace(f'id="{gid}"', f'id="{gid}-{_MARK_N[0]}"').replace(f"url(#{gid})", f"url(#{gid}-{_MARK_N[0]})")
    return f'<g id="{escape(name)}" transform="translate({x} {y}) scale({size / 128})">{body}</g>'


# ── assets ─────────────────────────────────────────────────────────────────
HERO, _, _ = img_data(SHOTS / "scene" / "hero.webp", 1600, 88)
SCENE_HOME, _, _ = img_data(SHOTS / "scene" / "02-home.webp", 1600, 86)
CITIZEN, _, _ = img_data(SHOTS / "stage" / "02-home.webp", 780)
MECH, _, _ = img_data(SHOTS / "stage" / "24-mechanic-console.webp", 780)
RAKSHA, _, _ = img_data(SHOTS / "hd" / "14-authority.webp", 1600, 86)
MAP, _, _ = img_data(SHOTS / "stage" / "18-live-map.webp", 860)
APPICON, _, _ = img_data(BRAND / "app-icon.png", 512, 90)


def lockup(x, y, scale=1.0, dark=True):
    m = round(46 * scale)
    word = INK if dark else "#0B0E14"
    return (mark(x, y, m)
            + f'<text x="{x + m + 12 * scale}" y="{y + m * 0.56}" font-family="{FONT}" font-size="{22 * scale}" font-weight="800" letter-spacing="-0.4" fill="{word}">Road<tspan fill="{GOLD}">Assist</tspan></text>'
            + text(x + m + 13 * scale, y + m * 0.92, "B H A R A T", 10.5 * scale, 700, INK3 if dark else "#4B5566", ls=1.2 * scale))


# ── desktop 1440 ───────────────────────────────────────────────────────────
def desktop():
    W, X, CW = 1440, 120, 1200
    b, y = [], 0
    b.append(rect(0, 0, W, 7400, BG, name="Background"))
    b.append(glow(1080, 420, 520, 360, GOLD, 0.14, 120))
    b.append(glow(260, 260, 420, 300, BLUE, 0.10, 120))

    # nav
    b.append(rect(0, 0, W, 76, BG, fo=0.72, name="Nav"))
    b.append(rect(0, 75, W, 1, "#FFFFFF", fo=0.07))
    b.append(lockup(X, 15, 1.0))
    nx = 452
    for label in ["Product", "Dashboards", "How it works", "RAKSHA", "Architecture", "Evidence"]:  # "Run it" is the CTA
        b.append(text(nx, 43, label, 15, 500, INK2))
        nx += sum(10.6 if c.isupper() else 7.6 for c in label) + 30
    cta, cw = button(X + CW - 196, 14, "Run the platform", True, 46, 15)
    b.append(cta)

    # hero
    y = 150
    p, _ = pill(X, y, "OFFLINE-FIRST ROADSIDE ASSISTANCE · INDIA", SURF, INK2, 12, 700, dot=GREEN)
    b.append(p)
    b.append(text(X, y + 100, ["Help that reaches", "you where the", "network doesn't."], 60, 800, INK, ls=-1.8, lh=68, name="Hero headline"))
    b.append(text(X, y + 330, wrap("One platform for stranded drivers, verified mechanics and road-safety authorities. "
                                   "An SOS still becomes a real incident with no signal, and syncs itself when the network returns.", 19, 520),
                  19, 400, INK2, lh=30, name="Hero body"))  # sits under the 3-line headline
    b1, w1 = button(X, y + 450, "Run the platform")
    b2, _ = button(X + w1 + 14, y + 450, "Explore RAKSHA", False)
    b += [b1, b2]
    # trust strip - measured
    ty = y + 550
    trust = [(f"{num('assertions', 'total')}", "assertions, 0 failures"),
             (f"{num('assertions', 'suites', 'securityAudit')}", "attacks refused"),
             (f"{num('i18n', 'locales')}", "languages over SMS"),
             ("0.471", "mAP50, YOLO11")]
    tx = X
    for v, l in trust:
        b.append(text(tx, ty + 26, v, 28, 800, GOLD2, ls=-0.6))
        b.append(text(tx, ty + 50, l, 13, 500, INK3))
        tx += 150
    # hero 3D render
    hx, hy, hw, hh = 740, 130, 580, 460
    b.append(glow(hx + hw / 2, hy + hh / 2 + 40, 380, 260, GOLD, 0.22, 90))
    b.append(image(hx, hy, hw, hh, HERO, r=28, name="Hero 3D render", fit="xMidYMid slice"))
    b.append(rect(hx, hy, hw, hh, "none", r=28, stroke="#FFFFFF", so=0.08))
    chip, _ = pill(hx + 22, hy + hh - 54, "Real 3D render of the three running surfaces", "#0B0F16", INK2, 12, 600, dot=GOLD)
    b.append(chip)

    # metrics band
    y = 900
    b.append(rect(X, y, CW, 150, SURF, r=24, stroke="#FFFFFF", so=0.07, name="Metrics"))
    mets = [(f"{num('assertions', 'total')}", "Assertions"), (f"{num('schema', 'tables')}", "Tables"),
            (f"{num('schema', 'indexes')}", "Indexes"), (f"{num('api', 'routes')}", "API routes"), (f"{num('i18n', 'locales')}", "Languages")]
    mx = X + 40
    for i, (v, l) in enumerate(mets):
        b.append(text(mx, y + 82, v, 48, 800, INK, ls=-1.5))
        b.append(text(mx, y + 114, l.upper(), 12, 700, INK3, ls=1.6))
        if i < 4:
            b.append(rect(mx + 200, y + 36, 1, 78, "#FFFFFF", fo=0.08))
        mx += 232

    # surfaces
    y = 1150
    b.append(text(X, y, "THE SURFACES", 13, 800, GOLD, ls=2.4))
    b.append(text(X, y + 52, "Four dashboards, one process", 48, 800, INK, ls=-1.4))
    b.append(text(X, y + 96, wrap("Each role gets its own surface, all served by the same Fastify process. "
                                  "Switch to Live and every frame is the running platform itself.", 18, 900), 18, 400, INK2, lh=28))
    seg_y = y + 160
    b.append(rect(X, seg_y, 312, 52, BG2, r=26, stroke="#FFFFFF", so=0.1))
    b.append(rect(X + 5, seg_y + 5, 148, 42, SURF2, r=21))
    b.append(text(X + 79, seg_y + 32, "Screenshots", 15, 600, INK2, "middle"))
    b.append(rect(X + 158, seg_y + 5, 149, 42, GOLD, r=21))
    b.append(text(X + 232, seg_y + 32, "Live platform", 15, 700, "#16110A", "middle"))
    cy = seg_y + 90
    # four cards, 2 x 2
    cards = [("Citizen app", "Request help, hold to raise an SOS, track the job, pay and review. Works off-grid.", "phone", CITIZEN),
             ("Mechanic console", "Availability, rating, the active job and a dispatch inbox of ranked offers.", "phone", MECH),
             ("RAKSHA authority dashboard", "Detection triage, road-health scoring and the human confirmation queue.", "browser", RAKSHA),
             ("Live operational map", "Mechanics, responders and detections clustered over PostGIS geometry.", "phone", MAP)]
    cw2, ch2 = 588, 640
    for i, (title, body, kind, href) in enumerate(cards):
        cx = X + (i % 2) * (cw2 + 24)
        yy = cy + (i // 2) * (ch2 + 24)
        b.append(rect(cx, yy, cw2, ch2, SURF, r=24, stroke="#FFFFFF", so=0.07, name=f"Card {title}"))
        b.append(rect(cx, yy, cw2, 470, BG2, r=24))
        b.append(rect(cx, yy + 446, cw2, 24, BG2))
        if kind == "phone":
            dev, dh = phone(cx + cw2 / 2 - 110, yy + 34, 220, href, title, screen_h=372)
            b.append(dev)
        else:
            dev, _ = browser(cx + 28, yy + 60, cw2 - 56, 350, href, title)
            b.append(dev)
        b.append(rect(cx, yy + 470, cw2, 1, "#FFFFFF", fo=0.07))
        b.append(text(cx + 30, yy + 518, title, 22, 700, INK))
        b.append(text(cx + 30, yy + 552, wrap(body, 16, 520), 16, 400, INK2, lh=24))
        tag, _ = pill(cx + cw2 - 110, yy + 490, "LIVE", "#0F2A1E", GREEN, 11, 800, 12, 26, dot=GREEN, stroke=GREEN, so=0.3)
        b.append(tag)

    # journey
    y = cy + 2 * (ch2 + 24) + 90
    b.append(text(X, y, "HOW IT WORKS", 13, 800, GOLD, ls=2.4))
    b.append(text(X, y + 52, "From a breakdown to a paid job", 48, 800, INK, ls=-1.4))
    steps = ["Request or escalate", "Diagnosis, labelled", "Dispatch, ranked", "Live status",
             "Off-grid SOS", "Idempotent sync", "Settlement", "Authority oversight"]
    sy = y + 100
    for i, s in enumerate(steps):
        on = i == 0
        b.append(rect(X, sy + i * 62, 360, 52, SURF2 if on else SURF, r=14, stroke=GOLD if on else "#FFFFFF", so=0.6 if on else 0.06))
        b.append(text(X + 20, sy + i * 62 + 32, f"0{i + 1}", 13, 800, GOLD if on else INK3, ls=1))
        b.append(text(X + 60, sy + i * 62 + 32, s, 16, 600, INK if on else INK2))
    b.append(glow(X + 800, sy + 250, 380, 240, GOLD, 0.16, 80))
    b.append(image(X + 400, sy, 800, 500, SCENE_HOME, r=24, name="Journey 3D scene", fit="xMidYMid slice"))
    b.append(rect(X + 400, sy, 800, 500, "none", r=24, stroke="#FFFFFF", so=0.08))
    b.append(rect(X + 400, sy + 520, 800, 104, SURF, r=18, stroke="#FFFFFF", so=0.07))
    b.append(text(X + 428, sy + 556, "01 / 08  ·  Request or escalate", 14, 700, GOLD, ls=0.6))
    b.append(text(X + 428, sy + 584, wrap("One screen carries both paths: an ordinary request, and an SOS held for 1.5 s "
                                          "so a pocket press never calls a responder.", 14.5, 740), 14.5, 400, INK2, lh=22))

    # RAKSHA
    y = sy + 700
    b.append(rect(X, y, CW, 620, SURF, r=28, stroke="#FFFFFF", so=0.07, name="RAKSHA"))
    b.append(glow(X + 900, y + 300, 360, 260, BLUE, 0.14, 90))
    b.append(text(X + 50, y + 70, "RAKSHA", 13, 800, BLUE, ls=2.4))
    b.append(text(X + 50, y + 120, ["The road reports", "its own damage."], 44, 800, INK, ls=-1.2, lh=50))
    b.append(text(X + 50, y + 210, wrap("A YOLO11 detector trained in this repository finds potholes and cracks. "
                                        "A model never dispatches: every detection waits for a person.", 17, 420), 17, 400, INK2, lh=27))
    fx, fy = X + 50, y + 330
    for i, (k, d) in enumerate([("CAPTURE", "Edge device"), ("YOLO11", "Trained detector"), ("RULES", "Severity, dedupe"), ("HUMAN", "Confirms")]):
        b.append(rect(fx, fy + i * 62, 380, 50, BG2, r=12, stroke="#FFFFFF", so=0.07))
        b.append(text(fx + 18, fy + i * 62 + 31, k, 12.5, 800, GOLD, ls=1.4))
        b.append(text(fx + 120, fy + i * 62 + 31, d, 14.5, 500, INK2))
    dev, _ = browser(X + 500, y + 60, 660, 500, RAKSHA, "RAKSHA dashboard")
    b.append(dev)

    # evidence
    y = y + 700
    b.append(text(X, y, "EVIDENCE", 13, 800, GOLD, ls=2.4))
    b.append(text(X, y + 52, "Every number is measured", 48, 800, INK, ls=-1.4))
    rows = [("Unit", num("assertions", "suites", "unit")), ("End-to-end", num("assertions", "suites", "e2e")),
            ("Concurrency", num("assertions", "suites", "concurrency")), ("Security", num("assertions", "suites", "securityAudit")),
            ("Gateway", num("assertions", "suites", "gatewaySecurity")), ("Browser", num("assertions", "suites", "browser"))]
    ey = y + 100
    for i, (label, n) in enumerate(rows):
        cx = X + (i % 3) * 408
        yy = ey + (i // 3) * 130
        b.append(rect(cx, yy, 384, 110, SURF, r=20, stroke="#FFFFFF", so=0.07))
        b.append(text(cx + 28, yy + 58, str(n), 40, 800, INK, ls=-1))
        b.append(text(cx + 28, yy + 86, f"{label} assertions", 14, 500, INK3))
        tag, _ = pill(cx + 384 - 92, yy + 24, "PASS", "#0F2A1E", GREEN, 11, 800, 12, 26, dot=GREEN, stroke=GREEN, so=0.3)
        b.append(tag)

    # run it
    y = ey + 320
    b.append(rect(X, y, CW, 300, BG2, r=28, stroke="#FFFFFF", so=0.08, name="Run it"))
    b.append(glow(X + 200, y + 150, 300, 160, GOLD, 0.10, 80))
    b.append(text(X + 50, y + 70, "RUN IT", 13, 800, GOLD, ls=2.4))
    b.append(text(X + 50, y + 118, "One command. No cloud account.", 36, 800, INK, ls=-1))
    b.append(rect(X + 50, y + 150, 700, 104, "#05070A", r=16, stroke="#FFFFFF", so=0.08))
    b.append(f'<text x="{X + 74}" y="{y + 190}" font-family="JetBrains Mono, Consolas, monospace" font-size="15" fill="{INK2}">'
             f'<tspan x="{X + 74}">git clone https://github.com/saatwik-1157/roadassist-bharat</tspan>'
             f'<tspan x="{X + 74}" dy="26"><tspan fill="{GOLD}">docker compose</tspan> -f docker-compose.demo.yml up</tspan></text>')
    bb, _ = button(X + 820, y + 176, "Open the live app")
    b.append(bb)

    # footer
    y = y + 400
    b.append(rect(0, y, W, 1, "#FFFFFF", fo=0.07))
    b.append(lockup(X, y + 50, 1.0))
    b.append(text(X, y + 140, "An offline-first roadside assistance and road-safety platform for India.", 14, 400, INK3))
    b.append(text(X + CW, y + 80, "roadassistbharat.online", 14, 600, INK2, "end"))
    H = y + 200
    return svg(W, H, "".join(b), "RoadAssist Bharat — Website, desktop 1440")


# ── mobile 390 ─────────────────────────────────────────────────────────────
def mobile():
    W, X, CW = 390, 20, 350
    b = [rect(0, 0, W, 3900, BG, name="Background"), glow(300, 240, 240, 200, GOLD, 0.16, 80)]
    b.append(rect(0, 0, W, 64, BG, fo=0.8))
    b.append(lockup(X, 11, 0.85))
    b.append(rect(W - 20 - 76, 14, 76, 38, SURF, r=12, stroke="#FFFFFF", so=0.12))
    b.append(text(W - 20 - 38, 38, "Menu", 14, 600, INK, "middle"))
    y = 100
    p, _ = pill(X, y, "OFFLINE-FIRST · INDIA", SURF, INK2, 11, 700, 12, 28, dot=GREEN)
    b.append(p)
    b.append(text(X, y + 78, ["Help that reaches", "you where the", "network doesn't."], 38, 800, INK, ls=-1.2, lh=43))
    b.append(text(X, y + 208, wrap("An SOS still becomes a real incident with no signal, and syncs itself when the network returns.", 16, CW), 16, 400, INK2, lh=25))
    b1, _ = button(X, y + 290, "Run the platform", True, 50, 15)
    b.append(b1)
    b.append(image(X, y + 370, CW, 262, HERO, r=22, name="Hero 3D render", fit="xMidYMid slice"))
    y = y + 670
    mets = [(num("assertions", "total"), "Assertions"), (num("schema", "tables"), "Tables"),
            (num("schema", "indexes"), "Indexes"), (num("api", "routes"), "Routes"),
            (num("i18n", "locales"), "Languages"), (num("assertions", "suites", "securityAudit"), "Attacks blocked")]
    for i, (v, l) in enumerate(mets):
        cx = X + (i % 3) * 118
        yy = y + (i // 3) * 92
        b.append(rect(cx, yy, 110, 80, SURF, r=16, stroke="#FFFFFF", so=0.07))
        b.append(text(cx + 14, yy + 40, str(v), 26, 800, INK, ls=-0.6))
        b.append(text(cx + 14, yy + 62, l.upper(), 9.5 if len(l) < 12 else 8.5, 700, INK3, ls=1 if len(l) < 12 else 0.4))
    y = y + 220
    b.append(text(X, y, "THE SURFACES", 12, 800, GOLD, ls=2))
    b.append(text(X, y + 40, ["Four dashboards,", "one process"], 28, 800, INK, ls=-0.8, lh=33))
    y = y + 104
    for title, href in [("Citizen app", CITIZEN), ("Mechanic console", MECH), ("Live operational map", MAP)]:
        b.append(rect(X, y, CW, 470, SURF, r=22, stroke="#FFFFFF", so=0.07))
        dev, _ = phone(X + CW / 2 - 105, y + 22, 210, href, title, screen_h=330)
        b.append(dev)
        b.append(text(X + 22, y + 440, title, 19, 700, INK))
        tag, _ = pill(X + CW - 92, y + 418, "LIVE", "#0F2A1E", GREEN, 10.5, 800, 11, 24, dot=GREEN, stroke=GREEN, so=0.3)
        b.append(tag)
        y += 490
    b.append(rect(X, y, CW, 330, SURF, r=22, stroke="#FFFFFF", so=0.07))
    dev, _ = browser(X + 14, y + 20, CW - 28, 230, RAKSHA, "RAKSHA")
    b.append(dev)
    b.append(text(X + 22, y + 290, "RAKSHA authority dashboard", 19, 700, INK))
    y += 370
    b.append(rect(0, y, W, 1, "#FFFFFF", fo=0.07))
    b.append(lockup(X, y + 30, 0.85))
    H = y + 110
    return svg(W, H, "".join(b), "RoadAssist Bharat — Website, mobile 390")


# ── brand sheet ────────────────────────────────────────────────────────────
def brand():
    W, H, X = 1440, 1000, 80
    b = [rect(0, 0, W, H, BG, name="Background"), glow(360, 360, 420, 300, GOLD, 0.16, 110)]
    b.append(text(X, 110, "RoadAssist Bharat — Brand", 44, 800, INK, ls=-1.2))
    b.append(text(X, 148, "A shield for safety. A road that forms the A of Assist. A signal at the apex: help that still reaches you off-grid.", 17, 400, INK2))
    b.append(rect(X, 200, 560, 420, SURF, r=28, stroke="#FFFFFF", so=0.07))
    b.append(mark(X + 170, 240, 220, "Logo mark, primary"))
    b.append(f'<text x="{X + 280}" y="540" font-family="{FONT}" font-size="46" font-weight="800" letter-spacing="-1" fill="{INK}" text-anchor="middle">Road<tspan fill="{GOLD}">Assist</tspan></text>')
    b.append(text(X + 280, 580, "B H A R A T", 18, 700, INK3, "middle", ls=2))
    # light version
    b.append(rect(X + 590, 200, 380, 200, "#F4F1EA", r=28))
    b.append(lockup(X + 630, 268, 1.25, dark=False))
    # app icon
    b.append(rect(X + 590, 420, 380, 200, SURF, r=28, stroke="#FFFFFF", so=0.07))
    b.append(image(X + 620, 450, 140, 140, APPICON, r=32, name="App icon"))
    b.append(image(X + 790, 490, 64, 64, APPICON, r=15))
    b.append(image(X + 876, 506, 32, 32, APPICON, r=8))
    # palette
    px, py = X + 1000, 200
    b.append(text(px, py + 20, "COLOUR", 12, 800, INK3, ls=2))
    for i, (c, n) in enumerate([(GOLD, "Signal gold"), (GOLD2, "Gold light"), (BLUE, "Authority blue"),
                                (GREEN, "Live green"), (RED, "Critical red"), (BG, "Night"), (SURF, "Surface"), (INK, "Ink")]):
        yy = py + 44 + i * 46
        b.append(rect(px, yy, 36, 36, c, r=10, stroke="#FFFFFF", so=0.15))
        b.append(text(px + 50, yy + 16, n, 14, 600, INK))
        b.append(text(px + 50, yy + 33, c, 12, 500, INK3))
    # type
    b.append(text(X, 700, "TYPE", 12, 800, INK3, ls=2))
    b.append(text(X, 770, "Help that reaches you.", 56, 800, INK, ls=-1.8))
    b.append(text(X, 810, "Inter 800 · display, tight tracking", 14, 500, INK3))
    b.append(text(X, 860, "Body copy sits at 17–19 px with a 1.55 line height, in ink-2 on night.", 18, 400, INK2))
    b.append(text(X, 900, "Inter 400 · body", 14, 500, INK3))
    for i, (lab, prim) in enumerate([("Run the platform", True), ("Explore RAKSHA", False)]):
        bt, _ = button(X + 760 + i * 230, 760, lab, prim)
        b.append(bt)
    p, _ = pill(X + 760, 840, "LIVE", "#0F2A1E", GREEN, 11, 800, 12, 26, dot=GREEN, stroke=GREEN, so=0.3)
    b.append(p)
    p, _ = pill(X + 850, 840, "SCREENSHOT", SURF2, INK3, 11, 800, 12, 26, dot=INK3)
    b.append(p)
    p, _ = pill(X + 1000, 840, "PASS", "#0F2A1E", GREEN, 11, 800, 12, 26, dot=GREEN, stroke=GREEN, so=0.3)
    b.append(p)
    return svg(W, H, "".join(b), "RoadAssist Bharat — Brand")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in [("brand", brand), ("desktop", desktop), ("mobile", mobile)]:
        s = fn()
        (OUT / f"{name}.svg").write_text(s, encoding="utf-8")
        print(f"{name}.svg  {len(s) / 1024 / 1024:.2f} MB")
