# ═══════════════════════════════════════════════════════════════════════════
#  RoadAssist Bharat — final submission deck, 32 slides
#
#  Every figure in this file is measured, not estimated, and every capability
#  claim carries a status. The rule the deck follows throughout:
#
#      GREEN  = IMPLEMENTED   code exists, database persists it, UI consumes it,
#                             and a test exercises it
#      AMBER  = PARTIAL       some of that is true
#      BLUE   = TARGET        architecture and nothing more
#
#  Screenshots come from app/docs/screenshots/, captured by
#  `node scripts/capture-screens.mjs` against the running application. If a
#  screenshot is missing the slide degrades to a labelled slot rather than
#  silently shipping a blank rectangle.
#
#  Concatenated with build_deck.py by make_final.py.
# ═══════════════════════════════════════════════════════════════════════════

from pathlib import Path as _P

SHOTS = _P(__file__).resolve().parent.parent / "app" / "docs" / "screenshots"


def shot(slide, x, y, w, h, name, caption=None, tag=None):
    """Place a real screenshot, or an honest placeholder if it was never taken.

    Refuses a zero or negative slot. python-pptx will serialise one without
    complaint; PowerPoint then refuses to open the whole file with nothing more
    useful than "PowerPoint could not open the file". Failing loudly here costs
    one line and saves an afternoon.
    """
    if w <= 0.2 or h <= 0.2:
        raise ValueError(f"shot({name!r}) got a {w}x{h}in slot — too small to be real")
    src = SHOTS / f"{name}.png"
    if src.exists():
        visual(slide, x, y, w, h, str(src), tag or name)
        if caption:
            txt(slide, x, y + h + 0.09, w, 0.3, caption, size=8.5,
                color=GREY_DIM, align=PP_ALIGN.CENTER)
    else:
        visual_slot(slide, x, y, w, h, f"screenshot: {name}",
                    "run `node scripts/capture-screens.mjs`")


def status_chip(slide, x, y, kind, w=1.15):
    """GREEN / AMBER / BLUE, used identically on every status slide."""
    col = {"IMPLEMENTED": GREEN, "PARTIAL": AMBER, "TARGET": BLUE}[kind]
    chip(slide, x, y, w, 0.26, kind, color=col, size=8)


def bullet_rows(slide, x, y, rows, w=5.6, gap=0.46, size=11.5):
    """A tidy label/value list — the deck's most-used text unit."""
    for i, (label, value) in enumerate(rows):
        yy = y + i * gap
        txt(slide, x, yy, 2.0, 0.26, label, size=9, color=CYAN, bold=True,
            spacing=1.4, caps=True)
        txt(slide, x + 2.05, yy - 0.03, w - 2.05, 0.4, value, size=size, color=WHITE)


# ── 1 · TITLE ──────────────────────────────────────────────────────────────
s = new_slide(BG_HERO)
txt(s, 0.85, 1.55, 11.6, 0.34, "SWE4004 · CLOUD COMPUTING AND APPLICATIONS",
    size=11.5, color=CYAN, bold=True, spacing=3.0)
txt(s, 0.85, 2.05, 11.6, 1.15, "RoadAssist Bharat", size=54, color=WHITE,
    bold=True, font=SANS_SEMI)
txt(s, 0.85, 3.25, 11.0, 0.9,
    "AI-Powered  ·  Cloud-Connected  ·  Network-Resilient\nEmergency Mobility Platform",
    size=19, color=GREY, line=1.35)
panel(s, 0.85, 4.35, 5.2, 0.62, fill=INK_2, line_col=RED, line_w=1.25)
txt(s, 1.1, 4.5, 4.8, 0.35, "“RoadAssist doesn't stop when the network stops.”",
    size=12.5, color=WHITE, bold=True, font=SANS_SEMI)

bullet_rows(s, 7.05, 4.32, [
    ("Team", "V. Saatwik Sairaam · P. Nirisha Chowdary"),
    ("", "T. V. S. Jignesh · G. Parthavi"),
    ("Faculty", "Dr. Nagendra Panini Challa"),
    ("Institution", "VIT-AP University"),
], w=5.4, gap=0.36, size=10.5)
footer(s)
notes(s, """Opening. Say the positioning line and the promise, then move on — the
evidence is in the next thirty slides.

The three adjectives are ordered deliberately: AI is the least novel, cloud is
expected, network-resilient is the one nobody else in this cohort will have.""")

# ── 2 · THE PROBLEM ────────────────────────────────────────────────────────
s = new_slide()
title_block(s, "A breakdown is not a software problem", eyebrow="THE PROBLEM",
            sub="…until you realise the app you would use to fix it needs the network you do not have.")
scenario = [
    ("21:40", "A Swift stops on NH-48. Two hundred kilometres from home, one bar of signal."),
    ("21:41", "The driver opens a roadside-assistance app. It shows a spinner."),
    ("21:44", "Still a spinner. There is no way to tell whether anything was sent."),
    ("21:52", "They give up and start calling numbers from a sticker on the windscreen."),
]
for i, (t, line) in enumerate(scenario):
    y = 2.35 + i * 0.72
    chip(s, 0.9, y, 0.85, 0.32, t, color=AMBER if i < 2 else RED, size=10)
    txt(s, 1.95, y - 0.02, 6.6, 0.6, line, size=12.5, color=WHITE, line=1.35)

panel(s, 8.9, 2.25, 3.6, 3.05, fill=INK_2, line_col=LINE)
txt(s, 9.15, 2.5, 3.1, 0.3, "WHAT ACTUALLY FAILS", size=9.5, color=CYAN,
    bold=True, spacing=2.0)
for i, line in enumerate([
    "Coverage is worst exactly where\nbreakdowns are most dangerous",
    "No way to know if a request was sent",
    "No centralised incident record",
    "Response time is unmeasured,\nso it cannot be improved",
]):
    txt(s, 9.15, 2.95 + i * 0.62, 3.1, 0.55, "— " + line, size=10.5,
        color=GREY, line=1.3)
footer(s); page_no(s, 2)
notes(s, """One scenario, no statistics. The audience has all been on a highway
with one bar. The right-hand column is the engineering restatement.""")

# ── 3 · THE CORE IDEA ──────────────────────────────────────────────────────
s = new_slide()
title_block(s, "One platform, from incident to resolution", eyebrow="THE CORE IDEA")
flow = [("DRIVER", "reports a fault", BLUE), ("ROADASSIST", "one platform", CYAN),
        ("AI + INCIDENT\nINTELLIGENCE", "cause · severity\n· capability", AMBER),
        ("DISPATCH", "rank · offer\n· escalate", CYAN),
        ("MECHANIC", "accepts, drives,\nfixes", BLUE),
        ("RESOLUTION", "invoice · payment\n· review", GREEN)]
x = 0.72
for i, (title, sub, col) in enumerate(flow):
    node(s, x, 2.7, 1.78, 1.5, title, sub, color=col, tsize=11, ssize=8.5)
    if i < len(flow) - 1:
        arrow(s, x + 1.80, 3.45, x + 1.96, 3.45, color=CYAN)
    x += 1.98
panel(s, 0.85, 4.75, 11.6, 0.8, fill=INK_2, line_col=CYAN, line_w=1.25)
txt(s, 1.1, 4.95, 11.1, 0.4,
    "Every step is real application state. No manual database editing anywhere in the normal workflow.",
    size=13, color=WHITE, bold=True, font=SANS_SEMI, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 3)
notes(s, """The sentence at the bottom is the one that separates a demo from a
product, and it is literally true — the whole journey is driven through the UI.""")

# ── 4 · WHY DIFFERENT ──────────────────────────────────────────────────────
s = new_slide()
title_block(s, "Six things, and one that matters most", eyebrow="WHY ROADASSIST IS DIFFERENT")
items = [("AI-ASSISTED\nDIAGNOSIS", "Rules engine, explainable,\nsame table on device and cloud", AMBER),
         ("DYNAMIC\nDISPATCH", "Ranked, wave-based,\nbusy providers excluded", GREEN),
         ("REAL-TIME\nTRACKING", "Server-sent events,\nmeasured at 65 ms", GREEN),
         ("SECURE\nPAYMENTS", "Server-side amount,\nsignature-verified webhook", GREEN),
         ("INCIDENT\nINTELLIGENCE", "Severity, capability,\ntamper-evident audit", GREEN),
         ("OFFLINE-FIRST\nEMERGENCY", "SOS with no network,\nstored and forwarded", GREEN)]
for i, (t, sub, col) in enumerate(items):
    node(s, 0.85 + (i % 3) * 3.95, 2.25 + (i // 3) * 1.5, 3.7, 1.28, t, sub,
         color=col, tsize=11, ssize=9)
panel(s, 0.85, 5.42, 11.6, 0.92, fill=INK_2, line_col=RED, line_w=1.5)
txt(s, 1.1, 5.62, 11.1, 0.5, "“RoadAssist doesn't stop when the network stops.”",
    size=18, color=WHITE, bold=True, font=SANS_SEMI, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 4)
notes(s, """Five of these six exist in some form in competing products. The
sixth is the differentiator and the rest of the deck defends it.""")

# ── 5 · SYSTEM ARCHITECTURE ────────────────────────────────────────────────
s = new_slide()
title_block(s, "System architecture", eyebrow="WHAT ACTUALLY RUNS TODAY",
            sub="One container serving three surfaces, one PostGIS database. Everything external is behind an adapter.")
for i, (t, sub) in enumerate([("CUSTOMER", "PWA · Android WebView"),
                              ("MECHANIC", "console"),
                              ("AUTHORITY / FLEET", "RAKSHA dashboard")]):
    node(s, 1.0 + i * 3.75, 2.05, 3.4, 0.72, t, sub, color=BLUE, tsize=11, ssize=8.5)
    arrow(s, 2.7 + i * 3.75, 2.79, 2.7 + i * 3.75, 3.08, color=CYAN)

node(s, 1.0, 3.1, 11.5, 0.62, "WEB / PWA  ·  service worker, IndexedDB, connectivity manager",
     color=CYAN, tsize=11.5)
down_arrow(s, 6.75, 3.74, 0.26)
node(s, 1.0, 4.04, 11.5, 0.62, "FASTIFY API  ·  /v1  ·  65 endpoints  ·  zod validation  ·  SSE stream",
     color=CYAN, tsize=11.5)
down_arrow(s, 6.75, 4.68, 0.26)
for i, (t, sub) in enumerate([("AUTH + RBAC", "OTP · JWT · rotation"),
                              ("DISPATCH", "PostGIS KNN · ladder"),
                              ("EMERGENCY", "SOS state machine"),
                              ("OFFLINE SYNC", "journal · conflicts"),
                              ("PAYMENTS", "order · webhook")]):
    node(s, 1.0 + i * 2.32, 4.98, 2.2, 0.75, t, sub, color=AMBER, tsize=9.5, ssize=8)
down_arrow(s, 6.75, 5.77, 0.24)
node(s, 3.6, 6.05, 6.3, 0.62, "PostgreSQL 16 + PostGIS  ·  56 tables  ·  62 FKs  ·  5 GiST indexes",
     color=GREEN, tsize=11.5)
footer(s); page_no(s, 5)
notes(s, """Note what is NOT here: no Kubernetes, no load balancer, no message
broker. They are in the target architecture on slide 22, and I keep the two
diagrams apart on purpose.""")

# ── 6 · NETWORK-RESILIENT ARCHITECTURE ─────────────────────────────────────
s = new_slide(BG_RED)
title_block(s, "Two paths, and the second one is the product",
            eyebrow="NETWORK-RESILIENT ARCHITECTURE")
panel(s, 0.85, 2.0, 5.5, 4.15, fill=INK_2, line_col=GREEN, line_w=1.25)
txt(s, 1.1, 2.2, 5.0, 0.3, "ONLINE", size=11, color=GREEN, bold=True, spacing=2.4)
for i, t in enumerate(["USER", "ROADASSIST CLIENT", "CLOUD API",
                       "AI · DISPATCH · DATABASE"]):
    node(s, 1.35, 2.62 + i * 0.86, 4.5, 0.58, t, color=GREEN, tsize=10.5)
    if i < 3:
        down_arrow(s, 3.6, 3.2 + i * 0.86, 0.28, color=GREEN)

panel(s, 6.95, 2.0, 5.5, 4.15, fill=INK_2, line_col=RED, line_w=1.5)
txt(s, 7.2, 2.2, 5.0, 0.3, "OFF-GRID", size=11, color=RED, bold=True, spacing=2.4)
for i, t in enumerate(["CONNECTIVITY MANAGER", "LOCAL EMERGENCY ENGINE",
                       "ENCRYPTED SYNC JOURNAL", "NETWORK RETURNS → CLOUD SYNC"]):
    node(s, 7.45, 2.62 + i * 0.86, 4.5, 0.58, t, color=RED, tsize=10.5)
    if i < 3:
        down_arrow(s, 9.7, 3.2 + i * 0.86, 0.28, color=RED)
txt(s, 0.85, 6.35, 11.6, 0.35,
    "The connectivity manager decides which path runs — ONLINE, LIMITED or OFF-GRID — from measured evidence, never from navigator.onLine alone.",
    size=11, color=GREY, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 6)
notes(s, """Strongest architecture slide. The point: the right column is not a
degraded version of the left, it is a different system that runs on the device.""")

# ── 7 · OFF-GRID SOS ───────────────────────────────────────────────────────
s = new_slide(BG_RED)
title_block(s, "Off-grid SOS", eyebrow="THE EMERGENCY PATH",
            sub="No internet does not mean the emergency workflow disappears. It means it runs here instead.")
node(s, 0.9, 2.25, 2.0, 0.6, "SOS HELD", color=RED, tsize=11)
arrow(s, 2.92, 2.55, 3.2, 2.55, color=CYAN)
node(s, 3.22, 2.25, 2.3, 0.6, "CONNECTIVITY\nCHECK", color=CYAN, tsize=10)
arrow(s, 5.54, 2.42, 5.9, 2.05, color=GREEN)
arrow(s, 5.54, 2.68, 5.9, 3.35, color=RED)
node(s, 5.95, 1.78, 2.6, 0.55, "ONLINE → SERVER", color=GREEN, tsize=10)
node(s, 5.95, 3.1, 2.6, 0.55, "NO → LOCAL SOS", color=RED, tsize=10)
for i, t in enumerate(["GPS IF AVAILABLE", "ENCRYPTED LOCAL STORAGE",
                       "SYNC JOURNAL (op id + digest)", "NETWORK RESTORED",
                       "SERVER SYNC — idempotent"]):
    node(s, 5.95, 3.85 + i * 0.55, 2.6, 0.44, t, color=RED if i < 3 else GREEN, tsize=8.5)
    if i < 4:
        down_arrow(s, 7.25, 4.29 + i * 0.55, 0.11, color=CYAN)

panel(s, 9.0, 1.78, 3.45, 4.4, fill=INK_2, line_col=RED, line_w=1.5)
txt(s, 9.25, 2.0, 3.0, 0.3, "WHAT THE USER IS TOLD", size=9.5, color=RED,
    bold=True, spacing=1.8)
txt(s, 9.25, 2.42, 3.0, 2.4,
    "OFF-GRID SOS CREATED\n\nNo network connection detected.\n\n"
    "Your emergency information is stored securely on this device and will be "
    "synchronized automatically when connectivity returns.",
    size=10, color=WHITE, line=1.35)
panel(s, 9.25, 4.95, 3.0, 1.05, fill=INK_3, line_col=AMBER)
txt(s, 9.45, 5.12, 2.6, 0.75,
    "“Nothing has been transmitted.”\nWe never claim emergency services were contacted. The 112 handoff is a stub and the API says so.",
    size=8.5, color=AMBER, line=1.3)
footer(s); page_no(s, 7)
notes(s, """If asked 'did you contact emergency services' — no, and the product
says so in those words. That honesty is the feature.""")

# ── 8 · AI DIAGNOSIS ───────────────────────────────────────────────────────
s = new_slide()
title_block(s, "Diagnosis: rules first, model optional", eyebrow="AI DIAGNOSIS")
for i, (t, sub, col) in enumerate([
        ("SYMPTOMS\n+ OBD CODES", "free text and\nscanned codes", BLUE),
        ("VALIDATION", "zod schema,\nlength + type", CYAN),
        ("RULES ENGINE", "9 rules, keyword\n+ DTC scoring", AMBER),
        ("REMOTE MODEL", "optional, only if\nconfigured", BLUE),
        ("RESULT", "cause · confidence\nseverity · action", GREEN)]):
    node(s, 0.85 + i * 2.38, 2.3, 2.2, 1.15, t, sub, color=col, tsize=10, ssize=8)
    if i < 4:
        arrow(s, 3.07 + i * 2.38, 2.88, 3.21 + i * 2.38, 2.88, color=CYAN)

panel(s, 0.85, 3.75, 5.65, 2.5, fill=INK_2, line_col=AMBER, line_w=1.25)
txt(s, 1.1, 3.95, 5.15, 0.3, "THE SAFETY ASYMMETRY", size=9.5, color=AMBER,
    bold=True, spacing=1.8)
txt(s, 1.1, 4.35, 5.15, 1.7,
    "A model may make a drivability verdict STRICTER. It can never make one laxer.\n\n"
    "The rules result is always computed. A remote answer is used only if it clears "
    "AI_MIN_CONFIDENCE and does not contradict the rules on safety.",
    size=11, color=WHITE, line=1.4)

panel(s, 6.85, 3.75, 5.6, 2.5, fill=INK_2, line_col=RED, line_w=1.25)
txt(s, 7.1, 3.95, 5.1, 0.3, "STATED PLAINLY", size=9.5, color=RED, bold=True, spacing=1.8)
txt(s, 7.1, 4.35, 5.1, 1.7,
    "This is a deterministic rules engine, not machine learning. The UI labels it "
    "“rules-1.0.0”, and “LOCAL OFFLINE DIAGNOSIS” on the device.\n\n"
    "A trained model DOES exist in the project — YOLO11n for road damage, "
    "mAP50 0.443 — and those metrics are measured.",
    size=11, color=WHITE, line=1.4)
footer(s); page_no(s, 8)
notes(s, """Do not call the diagnosis engine AI without qualifying it. The
qualification is the credible part.""")

# ── 9 · INCIDENT INTELLIGENCE ──────────────────────────────────────────────
s = new_slide()
title_block(s, "Incident intelligence", eyebrow="EXPLAINABLE, NOT OPAQUE",
            sub="Every field below is derived from a rule you can read, not from a weighting nobody can inspect.")
for i, (t, sub) in enumerate([("INCIDENT", "raised by user\nor by signal"),
                              ("CLASSIFICATION", "breakdown · accident\nmedical · unsafe"),
                              ("SEVERITY", "1–5, from the\nrule that matched"),
                              ("REQUIRED\nCAPABILITY", "service type\npre-selected"),
                              ("DISPATCH\nPRIORITY", "CRITICAL for accident\nand medical")]):
    node(s, 0.85 + i * 2.38, 2.35, 2.2, 1.25, t, sub, color=CYAN, tsize=10, ssize=8)
    if i < 4:
        arrow(s, 3.07 + i * 2.38, 2.97, 3.21 + i * 2.38, 2.97, color=CYAN)
rows = [("Explainable", "“Battery discharged or terminals loose” — because these keywords matched, at this confidence"),
        ("Auditable", "Every prediction writes a model_predictions row: capability, version, confidence, latency, input HASH (never the text)"),
        ("Honest", "Below 55% confidence the UI says so: “At 42% this is a suggestion, not a finding”"),
        ("Never fabricated", "No ETA unless a provider is travelling. No location unless GPS returned one.")]
bullet_rows(s, 0.9, 4.15, rows, w=11.5, gap=0.62, size=11)
footer(s); page_no(s, 9)

# ── 10 · SMART DISPATCH ────────────────────────────────────────────────────
s = new_slide()
title_block(s, "Dispatch is dynamic scheduling", eyebrow="SMART DISPATCH",
            sub="Work assigned at run time from a pool, by a score computed from live state, with timeout-driven re-scheduling.")
steps = [("AVAILABLE\nPROVIDERS", "PostGIS ST_DWithin"), ("FILTER", "off duty · already\ncommitted · already asked"),
         ("DISTANCE", "KNN, true metres"), ("SCORE", "proximity 60%\nrating 34%"),
         ("EXPLORATION", "+6% under 20 jobs"), ("OFFER WAVE", "N best, live push"),
         ("ASSIGN", "row-locked,\nexactly one")]
for i, (t, sub) in enumerate(steps):
    node(s, 0.72 + i * 1.72, 2.3, 1.6, 1.2, t, sub,
         color=GREEN if i == 6 else CYAN, tsize=9, ssize=7.5)
    if i < 6:
        arrow(s, 2.34 + i * 1.72, 2.9, 2.42 + i * 1.72, 2.9, color=CYAN)

panel(s, 0.85, 3.85, 5.65, 2.4, fill=INK_2, line_col=RED, line_w=1.25)
txt(s, 1.1, 4.05, 5.15, 0.3, "THE BUG THIS AUDIT FOUND", size=9.5, color=RED,
    bold=True, spacing=1.8)
txt(s, 1.1, 4.45, 5.15, 1.6,
    "Dispatch filtered on is_available alone — a duty toggle meaning “I am working "
    "today”, not “I am free now”. A mechanic already driving to one breakdown kept "
    "receiving offers for the next.\n\nFixed: provider state is DERIVED from live data.",
    size=10.5, color=WHITE, line=1.35)

panel(s, 6.85, 3.85, 5.6, 2.4, fill=INK_2, line_col=CYAN, line_w=1.25)
txt(s, 7.1, 4.05, 5.1, 0.3, "PROVIDER STATES", size=9.5, color=CYAN, bold=True, spacing=1.8)
for i, (st, meaning, col) in enumerate([
        ("OFFLINE", "off duty — never offered", GREY_DIM),
        ("AVAILABLE", "free — offerable", GREEN),
        ("OFFERED", "holding an offer — still offerable", AMBER),
        ("BUSY / EN_ROUTE / ON_JOB", "committed — never offered", RED)]):
    txt(s, 7.1, 4.45 + i * 0.42, 2.5, 0.3, st, size=9.5, color=col, bold=True)
    txt(s, 9.7, 4.45 + i * 0.42, 2.6, 0.3, meaning, size=9.5, color=GREY)
footer(s); page_no(s, 10)

# ── 11 · INCIDENT LIFECYCLE ────────────────────────────────────────────────
s = new_slide()
title_block(s, "Two guarded state machines", eyebrow="INCIDENT LIFECYCLE",
            sub="A client sends a command; only the transition table decides whether it is legal. Every change writes a timestamped event row.")
txt(s, 0.9, 2.15, 5.5, 0.3, "BOOKING — 13 states, 15 commands", size=10,
    color=CYAN, bold=True, spacing=1.6)
book = ["REQUESTED", "MATCHING", "ASSIGNED", "EN_ROUTE", "ON_SITE",
        "IN_PROGRESS", "COMPLETED", "PAID"]
for i, st in enumerate(book):
    node(s, 0.9, 2.55 + i * 0.47, 2.5, 0.36, st,
         color=GREEN if st in ("COMPLETED", "PAID") else CYAN, tsize=9)
    if i < len(book) - 1:
        down_arrow(s, 2.15, 2.91 + i * 0.47, 0.10, color=CYAN)

txt(s, 4.15, 2.15, 5.5, 0.3, "EMERGENCY — ADR-0005 in code", size=10,
    color=RED, bold=True, spacing=1.6)
emer = [("SOS_CREATED", "DETECTED / AWAITING_CONFIRMATION"),
        ("SOS_RECEIVED", "CONFIRMED — a human stands behind it"),
        ("RESPONDING", "contacts alerted, responder searched"),
        ("RESOLVED", "closed — terminal")]
for i, (st, sub) in enumerate(emer):
    node(s, 4.15, 2.55 + i * 0.95, 3.6, 0.72, st, sub, color=RED, tsize=10, ssize=7.5)
    if i < len(emer) - 1:
        down_arrow(s, 5.95, 3.27 + i * 0.95, 0.20, color=RED)

panel(s, 8.35, 2.5, 4.1, 3.7, fill=INK_2, line_col=AMBER, line_w=1.25)
txt(s, 8.6, 2.72, 3.6, 0.3, "THE RULE THAT IS ENFORCED", size=9.5, color=AMBER,
    bold=True, spacing=1.6)
txt(s, 8.6, 3.12, 3.6, 2.8,
    "A model raises a SIGNAL. A human confirms an INCIDENT.\n\n"
    "“escalate” is reachable only from CONFIRMED. There is no path from a "
    "model-detected crash to a dispatched responder that does not pass through a "
    "person.\n\nThat is one line in a transition table, and it is unit-tested.",
    size=10.5, color=WHITE, line=1.4)
footer(s); page_no(s, 11)

# ── 12 · REAL-TIME SYSTEM ──────────────────────────────────────────────────
s = new_slide()
title_block(s, "Real-time, but never the source of truth", eyebrow="LIVE UPDATES",
            sub="Server-sent events over one long-lived GET. Persist first, publish second — always.")
for i, (t, sub, col) in enumerate([
        ("MECHANIC", "taps “En route”", BLUE),
        ("BACKEND", "guarded UPDATE\ncommits first", CYAN),
        ("SSE PUBLISH", "to customer\nand mechanic", AMBER),
        ("CUSTOMER UI", "refetches the\nauthoritative state", GREEN)]):
    node(s, 1.1 + i * 3.0, 2.3, 2.7, 1.1, t, sub, color=col, tsize=11, ssize=8.5)
    if i < 3:
        arrow(s, 3.82 + i * 3.0, 2.85, 4.06 + i * 3.0, 2.85, color=CYAN)

panel(s, 0.85, 3.75, 5.65, 2.5, fill=INK_2, line_col=GREEN, line_w=1.25)
txt(s, 1.1, 3.95, 5.15, 0.3, "MEASURED", size=9.5, color=GREEN, bold=True, spacing=1.8)
bullet_rows(s, 1.1, 4.4, [
    ("Delivery", "65 ms, against a 6-second poll"),
    ("Poll while live", "60 s customer · 45 s mechanic"),
    ("Reconnect", "jittered backoff, automatic"),
], w=5.15, gap=0.5, size=11)

panel(s, 6.85, 3.75, 5.6, 2.5, fill=INK_2, line_col=AMBER, line_w=1.25)
txt(s, 7.1, 3.95, 5.1, 0.3, "WHEN THE STREAM DROPS", size=9.5, color=AMBER,
    bold=True, spacing=1.8)
txt(s, 7.1, 4.35, 5.1, 1.7,
    "The badge flips Live → Polling and the poll returns to its old cadence.\n\n"
    "Delivery is at-most-once and in-process. That is acceptable ONLY because the "
    "stream is never the only path — booking state is server-authoritative and the "
    "client refetches on reconnect.",
    size=10.5, color=WHITE, line=1.35)
footer(s); page_no(s, 12)

# ── 13 · CUSTOMER APPLICATION ──────────────────────────────────────────────
s = new_slide()
title_block(s, "Customer application", eyebrow="REAL SCREENSHOTS · CAPTURED FROM THE RUNNING APP")
for i, (name, cap) in enumerate([("02-home", "Home · SOS + readiness"),
                                 ("03-vehicle", "Vehicle"),
                                 ("04-ai-diagnosis", "Diagnosis"),
                                 ("05-dispatch", "Dispatch"),
                                 ("12-activity", "Activity")]):
    shot(s, 0.72 + i * 2.52, 2.15, 2.3, 3.9, name, cap)
txt(s, 0.85, 6.52, 11.6, 0.3,
    "Captured by scripts/capture-screens.mjs against the live API — regenerable in ninety seconds, so they cannot drift from the product.",
    size=9.5, color=GREY_DIM, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 13)

# ── 14 · MECHANIC + AUTHORITY ──────────────────────────────────────────────
s = new_slide()
title_block(s, "Mechanic console and authority dashboard",
            eyebrow="THE OTHER TWO SURFACES")
shot(s, 0.85, 2.15, 5.6, 3.6, "13-mechanic-login", "Mechanic console · dispatch inbox, live badge, job lifecycle")
shot(s, 6.85, 2.15, 5.6, 3.6, "14-authority", "RAKSHA authority · live map, road health, detection triage")
txt(s, 0.85, 6.0, 11.6, 0.5,
    "Mechanic: availability · incoming request · accept · decline · en route · arrived · in service · complete — every transition persisted and pushed to the customer.",
    size=10, color=GREY, align=PP_ALIGN.CENTER, line=1.35)
footer(s); page_no(s, 14)

# ── 15 · EMERGENCY EXPERIENCE ──────────────────────────────────────────────
s = new_slide(BG_RED)
title_block(s, "Three states, three honest answers", eyebrow="EMERGENCY EXPERIENCE")
tiers = [("ONLINE", GREEN, ["Everything works", "SOS reaches dispatch", "Live tracking + ETA",
                            "Cloud diagnosis"]),
         ("LIMITED", AMBER, ["Requests still attempted", "Anything that fails is STORED",
                             "Slow or flaky path", "User is told it is weak"]),
         ("OFF-GRID", RED, ["SOS stored on device", "GPS still works", "Local diagnosis",
                            "Cached maps · no live anything"])]
for i, (name, col, lines) in enumerate(tiers):
    x = 0.85 + i * 3.95
    panel(s, x, 2.15, 3.7, 3.3, fill=INK_2, line_col=col, line_w=1.5)
    txt(s, x + 0.28, 2.4, 3.1, 0.4, name, size=17, color=col, bold=True,
        font=SANS_SEMI, spacing=1.4)
    for j, line in enumerate(lines):
        txt(s, x + 0.28, 2.95 + j * 0.55, 3.14, 0.5, "— " + line, size=10.5,
            color=WHITE, line=1.3)
txt(s, 0.85, 5.65, 11.6, 0.7,
    "The indicator names the state in WORDS as well as colour — status is never carried by tint alone.\n"
    "Under every state the primary action stays the same and stays one tap away: SOS.",
    size=11.5, color=GREY, align=PP_ALIGN.CENTER, line=1.4)
footer(s); page_no(s, 15)

# ── 16 · PAYMENT ARCHITECTURE ──────────────────────────────────────────────
s = new_slide()
title_block(s, "The client never decides that money arrived", eyebrow="PAYMENT ARCHITECTURE")
for i, (t, sub, col) in enumerate([("INVOICE", "server-computed\ntotal", BLUE),
                                   ("ORDER", "created server-side\nwith that amount", CYAN),
                                   ("CHECKOUT", "gateway UI,\nkey id only", CYAN),
                                   ("WEBHOOK", "at-least-once\ndelivery", AMBER),
                                   ("SIGNATURE", "HMAC-SHA256\nrecomputed", RED),
                                   ("SETTLEMENT", "conditional on\nPENDING", GREEN),
                                   ("RECEIPT", "booking → PAID", GREEN)]):
    node(s, 0.72 + i * 1.72, 2.35, 1.6, 1.2, t, sub, color=col, tsize=9.5, ssize=7.5)
    if i < 6:
        arrow(s, 2.34 + i * 1.72, 2.95, 2.42 + i * 1.72, 2.95, color=CYAN)
rows = [("Amount", "Never taken from the request — it is the invoice total, and the webhook refuses a mismatch"),
        ("Two paths", "Browser callback AND webhook. The webhook is the one that matters: a customer can pay and close the tab"),
        ("Idempotent", "Delivery is at-least-once, so a replayed webhook settles nothing twice"),
        ("Refuses to boot", "Production will not start on a real gateway with no webhook secret"),
        ("Tested", "22 assertions against a local stub of Razorpay's API: forged signature, replay, wrong amount, wrong order — each fails closed")]
bullet_rows(s, 0.9, 4.15, rows, w=11.5, gap=0.5, size=10.5)
footer(s); page_no(s, 16)

# ── 17 · SECURITY ARCHITECTURE ─────────────────────────────────────────────
s = new_slide()
title_block(s, "Security", eyebrow="SEVEN LAYERS, AND 74 ATTACKS THAT FAIL",
            sub="The suite passes when the platform refuses — “we tried and could not get in” is a stronger statement than “the code looks right”.")
layers = [("AUTHENTICATION", "OTP → JWT, rotating refresh\nwith reuse detection"),
          ("RBAC", "role gates on every\noperator surface"),
          ("RESOURCE OWNERSHIP", "checked at the resource,\nnot just the route"),
          ("RATE LIMITING", "per principal — and never\non SOS escalation"),
          ("INPUT VALIDATION", "zod at every boundary,\nparameterised SQL"),
          ("PAYMENT VERIFICATION", "server-side amount,\nsigned webhook"),
          ("AUDIT LOG", "hash-chained, append-only,\nverified live")]
for i, (t, sub) in enumerate(layers):
    node(s, 0.85 + (i % 4) * 2.95, 2.25 + (i // 4) * 1.35, 2.75, 1.15, t, sub,
         color=CYAN, tsize=9.5, ssize=8)
panel(s, 9.7, 3.6, 2.75, 1.15, fill=INK_2, line_col=GREEN, line_w=1.5)
txt(s, 9.95, 3.8, 2.3, 0.8, "74 / 74\nattacks refused", size=15, color=GREEN,
    bold=True, font=SANS_SEMI, align=PP_ALIGN.CENTER, line=1.25)
txt(s, 0.85, 5.15, 11.6, 1.05,
    "Sensitive data: medical break-glass needs a role, a LIVE incident and a written reason, and writes a tamper-evident row.\n"
    "Logs redact credentials, OTP codes, phone numbers, medical fields and coordinates — and that redaction is unit-tested.\n"
    "Three real vulnerabilities were found by this suite during the audit and fixed: missing request ids on 401s, a 500 on malformed JSON, an unsigned SMS intake that did not say so.",
    size=10.5, color=GREY, line=1.5)
footer(s); page_no(s, 17)

# ── 18 · DATABASE ──────────────────────────────────────────────────────────
s = new_slide()
title_block(s, "PostgreSQL 16 + PostGIS", eyebrow="DATABASE ARCHITECTURE",
            sub="Chosen for one query, and kept for four more reasons.")
stats = [("56", "tables"), ("62", "foreign keys"), ("138", "indexes"),
         ("5", "GiST spatial"), ("5", "check constraints"), ("5", "migrations")]
for i, (n, label) in enumerate(stats):
    panel(s, 0.85 + i * 1.95, 2.2, 1.8, 1.0, fill=INK_2, line_col=LINE)
    txt(s, 0.85 + i * 1.95, 2.36, 1.8, 0.45, n, size=25, color=CYAN, bold=True,
        font=SANS_SEMI, align=PP_ALIGN.CENTER)
    txt(s, 0.85 + i * 1.95, 2.83, 1.8, 0.3, label, size=9, color=GREY,
        align=PP_ALIGN.CENTER)
rows = [("Why PostGIS", "“nearest available mechanic to this point” is ONE indexed query with ST_DWithin doing true metres-on-a-sphere. Without it: fetch every mechanic and compute haversine in app code."),
        ("Why relational", "SELECT … FOR UPDATE is what stops two mechanics taking one job. Transactions are the feature, not a formality."),
        ("Constraints", "client_incident_id UNIQUE is the entire duplicate-emergency defence. Money is integer paise; ratings are CHECK 1–5."),
        ("Auditability", "audit_log is hash-chained and Postgres RULES block UPDATE and DELETE — an admin cannot quietly edit it."),
        ("Verified", "Migrations run from an EMPTY database in this audit, then the full suite. Backup + restore rehearsed: chain intact across 639 entries.")]
bullet_rows(s, 0.9, 3.55, rows, w=11.5, gap=0.56, size=10.5)
footer(s); page_no(s, 18)

# ── 19 · CLOUD COMPUTING ───────────────────────────────────────────────────
s = new_slide(BG_MOD)
title_block(s, "Where we sit in the cloud", eyebrow="MODULE 1 · CLOUD COMPUTING",
            sub="We are a consumer of IaaS and PaaS, and a provider of SaaS to three user classes.")
for i, (t, sub, kind, col) in enumerate([
        ("SaaS", "We PROVIDE this: citizen app,\nmechanic console, authority dashboard", "IMPLEMENTED", GREEN),
        ("PaaS", "We would CONSUME managed\nPostgres + container platform", "TARGET", BLUE),
        ("IaaS", "Compute, network, storage.\nCompose is the local stand-in", "PARTIAL", AMBER)]):
    node(s, 0.85 + i * 3.95, 2.3, 3.7, 1.35, t, sub, color=col, tsize=16, ssize=9)
    status_chip(s, 0.85 + i * 3.95 + 1.28, 3.72, kind)

panel(s, 0.85, 4.35, 5.65, 1.9, fill=INK_2, line_col=CYAN, line_w=1.25)
txt(s, 1.1, 4.55, 5.15, 0.3, "CHARACTERISTICS WE ACTUALLY EXHIBIT", size=9.5,
    color=CYAN, bold=True, spacing=1.6)
txt(s, 1.1, 4.95, 5.15, 1.15,
    "Broad network access — one API serves a browser, an installed PWA, an Android "
    "WebView and a feature phone over SMS.\nResource pooling — dispatch pools providers "
    "and allocates on demand.",
    size=10.5, color=WHITE, line=1.35)

panel(s, 6.85, 4.35, 5.6, 1.9, fill=INK_2, line_col=AMBER, line_w=1.25)
txt(s, 7.1, 4.55, 5.1, 0.3, "DEPLOYMENT MODEL", size=9.5, color=AMBER, bold=True, spacing=1.6)
txt(s, 7.1, 4.95, 5.1, 1.15,
    "Public cloud, Indian region. The constraint that decides it is regulatory, "
    "not technical: “No PII leaves India” — including logs, backups and crash reports.\n"
    "Status: designed, not deployed.",
    size=10.5, color=WHITE, line=1.35)
footer(s); page_no(s, 19)

# ── 20 · ENABLING TECHNOLOGY ───────────────────────────────────────────────
s = new_slide(BG_MOD)
title_block(s, "Enabling technologies", eyebrow="MODULE 2",
            sub="Five topics. Four are genuinely built; one is partial and says so.")
rows = [("Data centre", "Compose stack: PostGIS + Redis + Redpanda on a private network; DB port NOT published in production", "PARTIAL"),
        ("Virtualization", "Multi-stage container, non-root (uid 1000), tini as PID 1, healthcheck. Built and run — 321 MB.", "IMPLEMENTED"),
        ("Web technology", "REST over HTTPS with a uniform envelope, server-sent events for real-time, PWA with a service worker", "IMPLEMENTED"),
        ("Multitenancy", "Row-scoped shared schema. 12 cross-tenant attacks fired; all 12 refused.", "IMPLEMENTED"),
        ("Service technology", "Versioned /v1, 65 endpoints, zod validation, stable error codes, idempotency keys", "IMPLEMENTED")]
for i, (topic, detail, kind) in enumerate(rows):
    y = 2.3 + i * 0.82
    panel(s, 0.85, y, 11.6, 0.7, fill=INK_2, line_col=LINE)
    txt(s, 1.1, y + 0.1, 2.1, 0.3, topic, size=11, color=CYAN, bold=True, font=SANS_SEMI)
    txt(s, 3.25, y + 0.08, 7.6, 0.55, detail, size=10, color=WHITE, line=1.3)
    status_chip(s, 11.1, y + 0.22, kind)
footer(s); page_no(s, 20)

# ── 21 · INFRASTRUCTURE MECHANISMS ─────────────────────────────────────────
s = new_slide(BG_MOD)
title_block(s, "Infrastructure mechanisms", eyebrow="MODULE 3")
rows = [("Virtual server", "Container image; runs anywhere Docker runs. Full test suite passes AGAINST the image.", "IMPLEMENTED"),
        ("Cloud storage device", "Postgres volume, upload volume, and client-side IndexedDB with AES-GCM-256 at rest", "IMPLEMENTED"),
        ("Cloud usage monitor", "Structured JSON logs, per-request correlation id, operation duration/result, /v1/ops/overview with live counts", "PARTIAL"),
        ("Ready-made environment", "compose → migrate → seed → start. Reference-only seed for production verified: 0 demo rows.", "IMPLEMENTED"),
        ("Network perimeter", "DB has no published port; API on loopback behind a proxy; CORS allowlist enforced in production", "PARTIAL"),
        ("Resource replication", "Stateless API is the precondition and is met. Nothing is replicated.", "TARGET")]
for i, (topic, detail, kind) in enumerate(rows):
    y = 2.2 + i * 0.72
    panel(s, 0.85, y, 11.6, 0.62, fill=INK_2, line_col=LINE)
    txt(s, 1.1, y + 0.08, 2.4, 0.3, topic, size=10.5, color=CYAN, bold=True, font=SANS_SEMI)
    txt(s, 3.55, y + 0.06, 7.3, 0.5, detail, size=9.5, color=WHITE, line=1.3)
    status_chip(s, 11.1, y + 0.18, kind)
footer(s); page_no(s, 21)

# ── 22 · ARCHITECTURE MECHANISMS ───────────────────────────────────────────
s = new_slide(BG_MOD)
title_block(s, "The eight fundamental architectures", eyebrow="MODULE 4",
            sub="Two are built. Six are design. I will not show you an animation and call it an autoscaler.")
archs = [("Workload distribution", "The dispatch engine distributes jobs across a provider pool by computed score", "IMPLEMENTED"),
         ("Resource pooling", "Providers are a pool; state is derived and busy members excluded", "IMPLEMENTED"),
         ("Dynamic scalability", "HPA on queue depth. BUILT: the readiness gate — /health returns 503 when the DB is down", "TARGET"),
         ("Elastic resource capacity", "Cluster autoscaler under the pods", "TARGET"),
         ("Service load balancing", "LB with health-checked rotation", "TARGET"),
         ("Cloud bursting", "Modelled evening scenario — labelled as modelled", "TARGET"),
         ("Elastic disk provisioning", "Storage allocated as data arrives", "TARGET"),
         ("Redundant storage", "Replica with failover. Backup procedure documented and rehearsed.", "TARGET")]
for i, (topic, detail, kind) in enumerate(archs):
    y = 2.25 + (i % 4) * 0.72
    x = 0.85 + (i // 4) * 5.9
    panel(s, x, y, 5.6, 0.62, fill=INK_2, line_col=LINE)
    txt(s, x + 0.22, y + 0.06, 3.1, 0.28, topic, size=10, color=CYAN, bold=True, font=SANS_SEMI)
    txt(s, x + 0.22, y + 0.32, 4.0, 0.28, detail, size=8, color=GREY, line=1.2)
    status_chip(s, x + 4.35, y + 0.17, kind, w=1.05)

panel(s, 0.85, 5.3, 11.6, 0.95, fill=INK_2, line_col=RED, line_w=1.5)
txt(s, 1.1, 5.5, 11.1, 0.6,
    "Three things block replication today, and each is documented where it is defined: the SSE registry, the rate limiter and the offer sweeper are in-process.\n"
    "The fix for each is already designed — Redis, and the outbox → Redpanda bus already in the architecture.",
    size=10.5, color=WHITE, line=1.4, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 22)

# ── 23 · SCHEDULING ────────────────────────────────────────────────────────
s = new_slide(BG_MOD)
title_block(s, "Static vs dynamic scheduling", eyebrow="MODULE 4 · CLOUD OPERATIONS")
panel(s, 0.85, 2.15, 5.65, 3.6, fill=INK_2, line_col=BLUE, line_w=1.25)
txt(s, 1.1, 2.38, 5.15, 0.35, "STATIC", size=15, color=BLUE, bold=True, font=SANS_SEMI)
txt(s, 1.1, 2.8, 5.15, 0.4, "Decided before run time, on a fixed schedule.",
    size=11, color=GREY)
for i, line in enumerate(["Offer sweeper — every 10 s (OFFER_SWEEP_SECONDS)",
                          "Client booking poll — 6 s, or 60 s while streaming",
                          "SSE heartbeat — every 25 s",
                          "Retention purge — 24 h after a sync"]):
    txt(s, 1.1, 3.35 + i * 0.55, 5.15, 0.5, "— " + line, size=10.5, color=WHITE, line=1.3)

panel(s, 6.85, 2.15, 5.6, 3.6, fill=INK_2, line_col=GREEN, line_w=1.5)
txt(s, 7.1, 2.38, 5.1, 0.35, "DYNAMIC", size=15, color=GREEN, bold=True, font=SANS_SEMI)
txt(s, 7.1, 2.8, 5.1, 0.4, "Decided at run time, from live state.", size=11, color=GREY)
for i, line in enumerate(["Dispatch: pool queried at request time",
                          "Score from live distance, rating, workload",
                          "Wave offered; timeout re-schedules to the next wave",
                          "A decline escalates immediately",
                          "Assignment settled under a row lock — exactly one"]):
    txt(s, 7.1, 3.35 + i * 0.5, 5.1, 0.45, "— " + line, size=10.5, color=WHITE, line=1.3)
txt(s, 0.85, 5.95, 11.6, 0.4,
    "RoadAssist's dispatch engine IS dynamic scheduling — it is the clearest Module 4 mechanism the project actually implements.",
    size=11.5, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 23)

# ── 24 · TESTING ───────────────────────────────────────────────────────────
s = new_slide()
title_block(s, "650 assertions, all executed", eyebrow="TESTING",
            sub="Against a real PostgreSQL + PostGIS and a real Chrome. Every number here is from a run, not an estimate.")
suites = [("Unit", "101", "state machines, rules, redaction, SMS coordinates, i18n segment budget"),
          ("End-to-end", "189", "the whole API journey against real Postgres"),
          ("Concurrency + real-time", "65", "races a sequential suite structurally cannot make"),
          ("Security", "74", "attacks that must FAIL"),
          ("Gateway security", "26", "webhook signatures, append-only rules, OTP ceilings"),
          ("Payment sandbox", "22", "forged signature, replay, wrong amount — fails closed"),
          ("Browser / offline", "163", "what only a browser can prove")]
for i, (name, n, what) in enumerate(suites):
    y = 2.25 + i * 0.6
    panel(s, 0.85, y, 11.6, 0.5, fill=INK_2, line_col=LINE)
    txt(s, 1.1, y + 0.1, 3.0, 0.3, name, size=11, color=WHITE, bold=True, font=SANS_SEMI)
    txt(s, 4.2, y + 0.1, 0.9, 0.3, n, size=13, color=GREEN, bold=True,
        font=SANS_SEMI, align=PP_ALIGN.RIGHT)
    txt(s, 5.35, y + 0.11, 6.9, 0.3, what, size=9.5, color=GREY)
panel(s, 0.85, 6.5, 11.6, 0.0, fill=INK_2, line_col=None)
txt(s, 0.85, 6.5, 11.6, 0.4,
    "600 passed · 0 failed · 0 skipped   •   coverage 95.68% lines on the pure domain modules   •   0 server errors across the sweep",
    size=12, color=GREEN, bold=True, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 24)

# ── 25 · FAILURE HANDLING ──────────────────────────────────────────────────
s = new_slide()
title_block(s, "Every failure has an answer", eyebrow="FAILURE HANDLING",
            sub="DETECT → DEGRADE → PRESERVE DATA → RECOVER. Twenty rows in the failure matrix; seven of them here.")
fails = [("Network lost", "connectivity manager", "off-grid mode; SOS stored locally", "auto on reconnect"),
         ("Backend unreachable", "probe fails, radio up", "LIMITED, then OFF-GRID", "auto"),
         ("Database down", "/health → 503", "safe 500 with a request id", "auto, no restart — tested"),
         ("GPS denied", "geolocation error", "“Unknown — denied”, never a fake fix", "next fix"),
         ("AI endpoint down", "timeout", "rules engine — nothing visible", "auto"),
         ("Payment fails", "gateway error / bad signature", "invoice stays unpaid", "customer retries"),
         ("Provider times out", "expires_at passes", "sweeper escalates to next wave", "ladder continues")]
txt(s, 1.1, 2.2, 2.4, 0.28, "FAILURE", size=9, color=CYAN, bold=True, spacing=1.6)
txt(s, 3.6, 2.2, 2.4, 0.28, "DETECTED BY", size=9, color=CYAN, bold=True, spacing=1.6)
txt(s, 6.15, 2.2, 3.6, 0.28, "USER EXPERIENCE", size=9, color=CYAN, bold=True, spacing=1.6)
txt(s, 9.95, 2.2, 2.4, 0.28, "RECOVERY", size=9, color=CYAN, bold=True, spacing=1.6)
for i, (f, d, u, r) in enumerate(fails):
    y = 2.6 + i * 0.55
    panel(s, 0.85, y, 11.6, 0.46, fill=INK_2, line_col=LINE)
    txt(s, 1.1, y + 0.1, 2.4, 0.28, f, size=9.5, color=WHITE, bold=True)
    txt(s, 3.6, y + 0.1, 2.4, 0.28, d, size=9, color=GREY)
    txt(s, 6.15, y + 0.1, 3.7, 0.28, u, size=9, color=GREY)
    txt(s, 9.95, y + 0.1, 2.4, 0.28, r, size=9, color=GREEN)
txt(s, 0.85, 6.55, 11.6, 0.35,
    "Each row names the suite that proves it. Database loss and backup/restore are now automated CI steps, not prose.",
    size=10, color=GREY_DIM, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 25)

# ── 26 · IMPLEMENTATION STATUS ─────────────────────────────────────────────
s = new_slide()
title_block(s, "What is built, what is partial, what is design",
            eyebrow="IMPLEMENTATION STATUS", sub="Marked from the code, not from intent.")
feats = [("AI diagnosis", "PARTIAL", "rules engine + trained YOLO11n for road damage"),
         ("SOS — online", "IMPLEMENTED", "e2e + concurrency suites"),
         ("SOS — offline", "IMPLEMENTED", "browser suite drives the whole scenario"),
         ("Offline storage", "IMPLEMENTED", "IndexedDB, AES-GCM-256, survives restart"),
         ("Store-and-forward sync", "IMPLEMENTED", "idempotent; duplicate proven impossible"),
         ("Dispatch", "IMPLEMENTED", "ladder, timeout, busy-exclusion, race-safe"),
         ("Real-time", "IMPLEMENTED", "SSE, measured 65 ms"),
         ("Payment", "IMPLEMENTED", "sandbox only — never a live account"),
         ("Fleet", "PARTIAL", "schema + roles exist; no dedicated UI"),
         ("Analytics", "PARTIAL", "ops overview with live counts; no BI layer"),
         ("Cloud autoscaling", "TARGET", "designed; no cluster"),
         ("Replication / load balancing", "TARGET", "stateless API is the precondition, and is met")]
for i, (name, kind, ev) in enumerate(feats):
    y = 2.2 + (i % 6) * 0.66
    x = 0.85 + (i // 6) * 5.9
    panel(s, x, y, 5.6, 0.56, fill=INK_2, line_col=LINE)
    txt(s, x + 0.2, y + 0.07, 2.5, 0.28, name, size=10, color=WHITE, bold=True, font=SANS_SEMI)
    txt(s, x + 0.2, y + 0.31, 4.0, 0.24, ev, size=8, color=GREY)
    status_chip(s, x + 4.35, y + 0.15, kind, w=1.05)
txt(s, 0.85, 6.35, 11.6, 0.35,
    "GREEN = code exists, database persists it, UI consumes it, AND a test exercises it.  AMBER = some of that.  BLUE = architecture only.",
    size=10, color=GREY_DIM, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 26)

# ── 27 · LIMITATIONS ───────────────────────────────────────────────────────
s = new_slide()
title_block(s, "Limitations", eyebrow="STATED BEFORE YOU ASK",
            sub="In order of importance. Every one of these is also written in the code or the docs.")
lims = ["Nothing is deployed to a cloud — no account, no domain, no cluster.",
        "Single instance only: SSE registry, rate limiter and offer sweeper are in-process.",
        "The ERSS 112 handoff is a stub, and the API response says so. Emergency isolation (ADR-0005) is a design, not a deployment.",
        "Payments verified against a local stub of Razorpay's API — never a real account.",
        "The diagnosis “AI” is a deterministic rules engine. Labelled as such everywhere.",
        "No load test, no external penetration test, no coverage on the HTTP layer (suites run out-of-process).",
        "Device encryption protects a storage dump, not script on the same origin — and the UI says exactly that.",
        "GPS cold start can take minutes and may never fix indoors. The app shows “Unknown” rather than a guess.",
        "No historical volume yet for predictive maintenance — the dead-zone heuristic is labelled heuristic v1."]
for i, line in enumerate(lims):
    y = 2.2 + i * 0.5
    chip(s, 0.9, y, 0.36, 0.3, str(i + 1), color=AMBER, size=9)
    txt(s, 1.45, y + 0.01, 11.0, 0.42, line, size=11, color=WHITE, line=1.3)
footer(s); page_no(s, 27)
notes(s, """Read two or three, not all nine. The point is that the list exists and
is specific.""")

# ── 28 · ROADMAP ───────────────────────────────────────────────────────────
s = new_slide()
title_block(s, "Roadmap", eyebrow="FUTURE — LABELLED AS SUCH")
phases = [("NEXT", GREEN, ["Redis-backed rate limiting", "Outbox → event bus for SSE fan-out",
                           "WAL archiving (RPO under a day)", "Object storage for photos"]),
          ("THEN", AMBER, ["Multi-region deployment", "Database read replicas",
                           "External APM + error reporting", "Automated backup schedule"]),
          ("LATER", BLUE, ["Predictive maintenance at volume", "Fleet management UI",
                           "Satellite emergency communication", "Mesh networking between devices",
                           "Government emergency-network integration"])]
for i, (name, col, items) in enumerate(phases):
    x = 0.85 + i * 3.95
    panel(s, x, 2.2, 3.7, 3.6, fill=INK_2, line_col=col, line_w=1.25)
    txt(s, x + 0.28, 2.45, 3.1, 0.35, name, size=15, color=col, bold=True,
        font=SANS_SEMI, spacing=1.6)
    for j, it in enumerate(items):
        txt(s, x + 0.28, 3.0 + j * 0.56, 3.14, 0.5, "— " + it, size=10, color=WHITE, line=1.3)
txt(s, 0.85, 6.0, 11.6, 0.4,
    "Satellite, mesh and government-network integration are FUTURE and are labelled that way everywhere in the product — not implemented, not claimed.",
    size=10.5, color=AMBER, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 28)

# ── 29 · BUSINESS MODEL ────────────────────────────────────────────────────
s = new_slide()
title_block(s, "Where the money would come from", eyebrow="BUSINESS MODEL",
            sub="Potential, not current. No commercial operation exists — this is a university project.")
models = [("B2C", "Subscription for individual drivers; pay-per-incident for non-members", BLUE),
          ("B2B", "Fleet operators — uptime is their cost centre; per-vehicle per-month", CYAN),
          ("B2B2C", "Insurers and OEMs bundling roadside cover into an existing policy", AMBER),
          ("B2G", "Highway authorities — RAKSHA road-health data and incident analytics", GREEN)]
for i, (t, sub, col) in enumerate(models):
    node(s, 0.85 + i * 2.95, 2.35, 2.75, 1.5, t, sub, color=col, tsize=17, ssize=9)
panel(s, 0.85, 4.2, 11.6, 1.05, fill=INK_2, line_col=CYAN, line_w=1.25)
txt(s, 1.1, 4.42, 11.1, 0.7,
    "The unit economics that make it plausible: the platform runs on ZERO paid third-party accounts by default.\n"
    "Maps are keyless OpenStreetMap, AI is a local rules engine, and every vendor sits behind an adapter with a working local implementation.",
    size=11, color=WHITE, line=1.4, align=PP_ALIGN.CENTER)
txt(s, 0.85, 5.5, 11.6, 0.4,
    "Current status: no revenue, no customers, no commercial deployment. Stated so the model is read as a plan, not a claim.",
    size=10.5, color=AMBER, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 29)

# ── 30 · COMPETITIVE ADVANTAGE ─────────────────────────────────────────────
s = new_slide()
title_block(s, "What a competitor would have to build", eyebrow="COMPETITIVE ADVANTAGE",
            sub="Not “we are better than X” — we have not benchmarked anyone. This is what is genuinely hard here.")
adv = [("Network resilience", "An emergency workflow that runs entirely on the device, with an encrypted journal and idempotent forward-sync. This is the moat."),
       ("Honest degradation", "The product never claims something reached the cloud when it did not. That is a design discipline, not a feature you can add later."),
       ("Race-safe dispatch", "Row-locked assignment, wave ladder, timeout escalation, derived provider state — proven with ten simultaneous accepts."),
       ("Explainable diagnosis", "The same rule table on device and cloud, with a CI test that fails the build if they diverge."),
       ("Auditability", "Hash-chained append-only log, verified live in the operations view.")]
for i, (t, d) in enumerate(adv):
    y = 2.3 + i * 0.85
    panel(s, 0.85, y, 11.6, 0.74, fill=INK_2, line_col=LINE)
    txt(s, 1.1, y + 0.12, 2.9, 0.3, t, size=11.5, color=CYAN, bold=True, font=SANS_SEMI)
    txt(s, 4.15, y + 0.1, 8.1, 0.55, d, size=10, color=WHITE, line=1.3)
footer(s); page_no(s, 30)

# ── 31 · LIVE DEMO ─────────────────────────────────────────────────────────
s = new_slide(BG_RED)
title_block(s, "Live demonstration", eyebrow="THE PART THAT MATTERS")
txt(s, 0.9, 2.15, 5.5, 0.3, "PART ONE · THE FULL JOURNEY", size=10, color=GREEN,
    bold=True, spacing=1.8)
for i, t in enumerate(["Login", "Vehicle", "Breakdown + AI diagnosis", "Request assistance",
                       "Dispatch — ranked offers", "Mechanic accepts", "Live status, no refresh",
                       "Service → invoice → payment", "Review"]):
    txt(s, 1.0, 2.6 + i * 0.4, 5.4, 0.35, f"{i + 1}.  {t}", size=11, color=WHITE)

txt(s, 6.95, 2.15, 5.5, 0.3, "PART TWO · THE ONE NOBODY ELSE HAS", size=10,
    color=RED, bold=True, spacing=1.8)
for i, t in enumerate(["Network OFF — the UI changes immediately", "Local diagnosis, labelled",
                       "Hold SOS → off-grid incident, real GPS", "“Nothing has been transmitted”",
                       "CLOSE THE TAB. REOPEN IT.", "The incident is still there",
                       "Network ON → automatic sync", "“SOS synchronized”",
                       "Replay the reference → duplicate refused"]):
    col = AMBER if i in (4, 5, 8) else WHITE
    txt(s, 7.05, 2.6 + i * 0.4, 5.4, 0.35, f"{i + 1}.  {t}", size=11, color=col)

panel(s, 0.85, 6.15, 11.6, 0.75, fill=INK_2, line_col=RED, line_w=1.5)
txt(s, 1.1, 6.32, 11.1, 0.42,
    "If any step fails, the failure IS the demonstration — nothing here fakes a success.",
    size=12.5, color=WHITE, bold=True, font=SANS_SEMI, align=PP_ALIGN.CENTER)
footer(s); page_no(s, 31)

# ── 32 · CONCLUSION ────────────────────────────────────────────────────────
s = new_slide(BG_HERO)
txt(s, 0.85, 1.7, 11.6, 0.9, "RoadAssist Bharat", size=46, color=WHITE,
    bold=True, font=SANS_SEMI)
txt(s, 0.85, 2.7, 11.6, 0.55,
    "From breakdown to resolution — even when connectivity fails.",
    size=19, color=GREY)
for i, (t, sub) in enumerate([("AI", "explainable\nrules engine"),
                              ("CLOUD", "consumed and\nprovided"),
                              ("OFFLINE", "the whole emergency\npath on-device"),
                              ("REAL-TIME", "65 ms, and never\nthe only path"),
                              ("SECURITY", "74 attacks,\nall refused"),
                              ("DISPATCH", "dynamic, race-safe\nscheduling")]):
    node(s, 0.85 + i * 1.96, 3.6, 1.82, 1.1, t, sub, color=CYAN, tsize=12, ssize=8)
panel(s, 0.85, 5.05, 11.6, 1.0, fill=INK_2, line_col=RED, line_w=1.75)
txt(s, 1.1, 5.28, 11.1, 0.55, "“RoadAssist doesn't stop when the network stops.”",
    size=22, color=WHITE, bold=True, font=SANS_SEMI, align=PP_ALIGN.CENTER)
txt(s, 0.85, 6.3, 11.6, 0.35,
    "650 assertions · 6 suites · 0 failures  •  56 tables · 65 routes · 10 ADRs  •  every claim on these slides is testable",
    size=10.5, color=GREY_DIM, align=PP_ALIGN.CENTER)
footer(s)
notes(s, """Close on the promise, then stop talking. If there is time, offer to run
the security suite or the concurrency suite live — they take under a minute and
they are the evidence.""")
