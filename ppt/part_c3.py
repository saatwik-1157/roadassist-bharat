

# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 13 — M3 INTRO
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "MODULE 3 — CLOUD INFRASTRUCTURE MECHANISMS",
            eyebrow="THE FIVE BUILDING BLOCKS", size=29, badge=ARCH)
mech = [("NETWORK\nPERIMETER", "Controlled boundary\nbetween the internet\nand internal services",
         BLUE, "PARTIAL"),
        ("VIRTUAL\nSERVER", "Virtualized compute\nrunning platform\nworkloads", CYAN, "CONCEPT"),
        ("CLOUD STORAGE\nDEVICE", "Persistent, addressable\nstorage for platform\ndata", CYAN, "PARTIAL"),
        ("CLOUD USAGE\nMONITOR", "Collects usage and\nperformance data for\nbilling and scaling", AMBER, "PARTIAL"),
        ("RESOURCE\nREPLICATION", "Multiple instances of\na resource for scale\nand resilience", GREEN, "CONCEPT")]
x = 0.85
for t, d, c, stat in mech:
    node(s, x, 2.6, 2.2, 1.85, t, d, color=c, tsize=11, ssize=8.5)
    chip(s, x + 0.42, 4.55, 1.36, 0.28, stat, color=(AMBER if stat == "PARTIAL" else CYAN),
         size=7.5, fill=INK_2)
    arrow(s, x + 1.1, 4.9, x + 1.1, 5.22, color=c, width=1.1)
    x += 2.32
panel(s, 0.85, 5.25, 11.6, 0.85, fill=INK_3, line_col=BLUE, line_w=1.5)
txt(s, 1.0, 5.42, 11.3, 0.35, "ROADASSIST PLATFORM", size=14, color=WHITE, bold=True,
    align=PP_ALIGN.CENTER, font=SANS_SEMI)
txt(s, 1.0, 5.76, 11.3, 0.3,
    "Each mechanism is examined next against what the project actually does",
    size=10, color=CYAN, align=PP_ALIGN.CENTER)
txt(s, 0.85, 6.25, 11.6, 0.4,
    "PARTIAL means a real but limited form exists — for example a health endpoint reporting database latency "
    "is a usage monitor, but not a full monitoring stack. CONCEPT means the mechanism is designed for, not built.",
    size=9.5, color=GREY_DIM, line=1.35)
module_rail(s, 3); page_no(s, 13)
notes(s, """MEANING
The five Module 3 mechanisms with honest status chips, setting up the next four slides.

SAY
"Module 3 defines five infrastructure mechanisms: the network perimeter, virtual servers, cloud storage devices, cloud usage monitors, and resource replication. I have marked each with what we actually have. Three are partial - real but limited. Two are architectural concepts we designed toward but did not build."

CONCEPT DEMONSTRATED
Module 3 - the complete set of infrastructure mechanisms.

RELATION TO ROADASSIST
Being specific about 'partial' matters. Our health endpoint reports database latency and provider status on every call - that is genuinely a usage monitor, but it is not Prometheus and Grafana, and I will not claim it is.

IF ASKED
"Why not just say you implemented all five?" - Because that would be false, and an evaluator can check. Precision about what exists is worth more than an inflated claim.

TRANSITION
"Starting at the boundary - the network perimeter."
""")
