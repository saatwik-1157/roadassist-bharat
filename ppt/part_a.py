

# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 1 — HERO
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_HERO)
txt(s, 0.9, 1.55, 8.6, 0.35, "SWE4004 · CLOUD COMPUTING AND APPLICATIONS",
    size=11, color=CYAN, bold=True, spacing=3.0)
txt(s, 0.9, 2.0, 9.4, 1.5, "ROADASSIST\nBHARAT", size=62, color=WHITE, bold=True,
    font=SANS_SEMI, line=0.95)
bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.9), Inches(3.78),
                         Inches(1.5), Inches(0.05))
bar.fill.solid(); bar.fill.fore_color.rgb = BLUE; bar.line.fill.background()
bar.shadow.inherit = False
txt(s, 0.9, 4.02, 7.0, 0.9,
    "AI-POWERED ROADSIDE ASSISTANCE\n& EMERGENCY MOBILITY PLATFORM",
    size=18, color=GREY, font=SANS, line=1.35, spacing=1.2)
for i, (lab, col) in enumerate([("AI", CYAN), ("CLOUD", BLUE),
                                ("MOBILITY", GREEN), ("SAFETY", RED)]):
    chip(s, 0.9 + i * 1.5, 5.2, 1.38, 0.36, lab, color=col, size=10)
txt(s, 0.9, 5.9, 7.0, 0.3,
    "A working platform used to demonstrate Cloud Computing Modules 1-4",
    size=11, color=GREY_DIM, italic=True)
# The real application, in perspective device frames over a network field —
# rendered by render_visuals.py from actual screenshots of the running system.
visual(s, 8.15, 1.42, 4.3, 4.35, str(ASSETS / "vis_hero.png"), "hero")
footer(s); page_no(s, 1)
notes(s, """MEANING
Opening frame. RoadAssist Bharat is a real, working roadside-assistance platform, and this deck uses it as the worked example for Cloud Computing Modules 1-4.

SAY
"This is RoadAssist Bharat - an AI-assisted roadside assistance and emergency mobility platform for India. What I want to show today is not just the application, but how every layer of it maps onto the cloud computing concepts in Modules 1 through 4."

CONCEPT DEMONSTRATED
Framing only. The four chips - AI, Cloud, Mobility, Safety - are the four threads running through the deck.

RELATION TO ROADASSIST
The platform genuinely exists: TypeScript, Fastify, PostgreSQL with PostGIS, a Progressive Web App, 58 API routes, 61 database tables.

IF ASKED
"Is this real or a mockup?" - It is real and running. I can show the live application, the test suite and the database at any point.

TRANSITION
"Let me start with the problem it exists to solve."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 2 — PROBLEM
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_RED)
title_block(s, "WHEN THE ROAD STOPS,\nTHE PROBLEM STARTS.",
            eyebrow="THE REAL-WORLD PROBLEM", size=32)
steps = [("BREAKDOWN", "Flat tyre, dead battery,\noverheating, no fuel", RED),
         ("UNCERTAINTY", "What is wrong?\nIs it safe to drive?", AMBER),
         ("FINDING HELP", "Who is nearby?\nAre they free?", AMBER),
         ("LOCATION", "Describing where you are\non an unmarked road", CYAN),
         ("WAITING", "No ETA, no visibility,\nno progress", CYAN),
         ("SAFETY", "Roadside at night,\nnobody informed", RED)]
x = 0.85
for i, (t, d, c) in enumerate(steps):
    node(s, x, 2.75, 1.83, 1.45, t, d, color=c, tsize=11, ssize=8.5)
    if i < len(steps) - 1:
        arrow(s, x + 1.85, 3.47, x + 1.96, 3.47, color=GREY_DIM, width=1.1)
    x += 1.98
txt(s, 0.85, 4.5, 11.6, 0.9,
    "Every one of these six failures is an information problem before it is a mechanical one.\n"
    "The driver cannot diagnose, cannot locate, cannot summon, and cannot see what happens next.",
    size=13.5, color=GREY, line=1.45)
panel(s, 0.85, 5.5, 11.6, 0.95, fill=INK_2, line_col=LINE)
txt(s, 1.15, 5.7, 11.0, 0.6,
    "A cloud platform is the natural answer, because the information needed - who is nearby, what the fault is, "
    "where the vehicle is, who has been told - lives in different places and must be brought together in real time.",
    size=12.5, color=WHITE, line=1.35)
footer(s); page_no(s, 2)
notes(s, """MEANING
The six-stage chain from breakdown to danger. Deliberately no statistics - none are invented anywhere in this deck.

SAY
"When a vehicle stops, the mechanical fault is only the first problem. The driver then cannot diagnose it, cannot describe where they are, cannot tell who is nearby, and has no visibility of help arriving. Each of those is an information problem, and information problems are what cloud platforms solve."

CONCEPT DEMONSTRATED
Motivation for centralised, always-available services - the goals and benefits of cloud adoption, Module 1.

RELATION TO ROADASSIST
Each stage maps to a built feature: AI diagnosis, GPS with PostGIS location, dispatch, live tracking, and the Raksha SOS system.

IF ASKED
"Do you have data on breakdown frequency?" - I deliberately did not invent figures. The design is driven by the failure chain, not by claimed statistics.

TRANSITION
"So the vision is a single platform that closes every one of those gaps."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 3 — VISION
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_DEEP)
title_block(s, "ONE PLATFORM. EVERY ROAD. EVERY RESPONSE.",
            eyebrow="PROJECT VISION", size=30, badge=IMPL)
panel(s, 4.35, 2.85, 4.6, 1.45, fill=INK_3, line_col=BLUE, line_w=1.6)
txt(s, 4.5, 3.08, 4.3, 0.4, "ROADASSIST CLOUD PLATFORM", size=14.5, color=WHITE,
    bold=True, align=PP_ALIGN.CENTER, font=SANS_SEMI)
txt(s, 4.5, 3.5, 4.3, 0.6,
    "Fastify API · PostgreSQL + PostGIS\n58 routes · 61 tables · role-scoped access",
    size=9.5, color=CYAN, align=PP_ALIGN.CENTER, line=1.3, font=MONO)
ring = [("CUSTOMER", "PWA · offline-first", 0.85, 2.2, GREEN),
        ("AI DIAGNOSIS", "rules engine", 0.85, 3.42, CYAN),
        ("MECHANIC", "dispatch console", 0.85, 4.64, BLUE),
        ("LIVE MAP", "OpenStreetMap", 9.55, 2.2, BLUE),
        ("RAKSHA / SOS", "emergency path", 9.55, 3.42, RED),
        ("AUTHORITY", "road health", 9.55, 4.64, CYAN)]
for t, d, nx, ny, c in ring:
    node(s, nx, ny, 2.9, 1.0, t, d, color=c, tsize=11.5, ssize=9)
    if nx < 4:
        arrow(s, nx + 2.92, ny + 0.5, 4.33, 3.57, color=c, width=1.15)
    else:
        arrow(s, 8.97, 3.57, nx - 0.02, ny + 0.5, color=c, width=1.15)
txt(s, 0.85, 6.05, 11.6, 0.65,
    "The cloud platform is the backbone: the only component every actor talks to, and the only place "
    "that knows the whole truth about a booking, an incident or a vehicle.",
    size=13, color=GREY, line=1.4)
footer(s); page_no(s, 3)
notes(s, """MEANING
The ecosystem. Six actors, one central platform. No actor talks directly to another.

SAY
"Six participants: the customer, AI diagnosis, the mechanic, the live map, the Raksha emergency system, and the road authority. None talk to each other directly. Everything goes through the central platform, and that is what makes the platform authoritative."

CONCEPT DEMONSTRATED
Centralised, network-accessible shared services - the essential cloud characteristics, Module 1.

RELATION TO ROADASSIST
Verified: 58 API routes, 61 tables, seven roles - citizen, mechanic, admin, gov_officer, fleet_admin, fleet_driver, support.

IF ASKED
"Why must everything go through the centre?" - Because booking state is server-authoritative. If a mechanic's phone could tell a customer's phone directly that a job was finished, the two devices could disagree. The server is the single source of truth, and the state machine there is the only thing allowed to change a booking's state.

TRANSITION
"Which raises the question this course is really about - why does this need the cloud at all?"
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 4 — WHY CLOUD (bridge into Module 1)
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "WHY ROADASSIST NEEDS THE CLOUD",
            eyebrow="MODULE 1 · THE BRIDGE", size=32, badge=ARCH)
x = 0.85
for c in ["CUSTOMER", "MECHANIC", "AUTHORITY", "WEBSITE / PWA"]:
    node(s, x, 2.4, 2.7, 0.6, c, color=GREEN, tsize=11)
    arrow(s, x + 1.35, 3.03, x + 1.35, 3.45, color=GREEN, width=1.2)
    x += 2.9
panel(s, 0.85, 3.48, 11.6, 1.12, fill=INK_3, line_col=BLUE, line_w=1.5)
txt(s, 1.0, 3.63, 11.3, 0.35, "CENTRAL CLOUD PLATFORM", size=14, color=WHITE,
    bold=True, align=PP_ALIGN.CENTER, font=SANS_SEMI)
cx = 1.0
for c in ["Centralised services", "Anywhere access", "Shared resources",
          "Scalability", "Availability", "Real-time exchange"]:
    chip(s, cx, 4.06, 1.83, 0.34, c, color=CYAN, size=8.5, fill=INK_2)
    cx += 1.9
for i, lab in enumerate(["COMPUTE", "STORAGE", "NETWORK", "DATA"]):
    arrow(s, 2.2 + i * 2.9, 4.63, 2.2 + i * 2.9, 5.02, color=BLUE, width=1.2)
    node(s, 0.85 + i * 2.9, 5.05, 2.7, 0.6, lab, color=BLUE, tsize=11)
txt(s, 0.85, 5.95, 11.6, 0.7,
    "Without the cloud, each actor would hold its own copy of the truth and reconcile it later. "
    "With it, one authoritative service is reachable from any road, on any device, at any hour.",
    size=13, color=GREY, line=1.4)
module_rail(s, 1); page_no(s, 4)
notes(s, """MEANING
The bridge slide - it turns the project story into the Module 1 story.

SAY
"Four kinds of consumer - customers, mechanics, authorities and the public website - all reach one central platform, which draws on compute, storage, network and data. The six capabilities in the middle band are exactly the cloud characteristics from Module 1."

CONCEPT DEMONSTRATED
Module 1: goals and benefits of cloud adoption, and the essential characteristics.

RELATION TO ROADASSIST
All four consumer types exist as real surfaces: the customer PWA, the mechanic console, the RAKSHA authority dashboard, and the public site.

IF ASKED
"Could this not just be one server?" - It could, and in development it is. The cloud model matters because demand is uneven and geographically spread, and because an emergency service should not have a single point of failure. That is an architectural argument, which is why this slide is labelled architectural concept rather than implemented.

TRANSITION
"So let us take Module 1 properly."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 5 — M1 FUNDAMENTALS
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "MODULE 1 — UNDERSTANDING CLOUD COMPUTING",
            eyebrow="ORIGINS · CONCEPTS · CHARACTERISTICS", size=29, badge=ARCH)
panel(s, 0.85, 2.35, 5.45, 3.42, fill=INK_2, line_col=LINE)
txt(s, 1.1, 2.55, 4.9, 0.32, "THE FIVE ESSENTIAL CHARACTERISTICS", size=10.5,
    color=CYAN, bold=True, spacing=1.8)
chars = [("On-demand self-service",
          "A user signs in and books assistance; nobody provisions anything."),
         ("Broad network access",
          "Reachable from any phone browser - the PWA needs no install."),
         ("Resource pooling",
          "One platform, one database, one API serve every customer and mechanic."),
         ("Rapid elasticity",
          "Capacity can follow demand; festival and monsoon peaks are not steady state."),
         ("Measured service",
          "Usage is observable per request, which is what makes scaling decidable.")]
y = 3.0
for t, d in chars:
    chip(s, 1.1, y + 0.02, 0.22, 0.22, "", color=CYAN, fill=CYAN)
    txt(s, 1.45, y - 0.03, 4.6, 0.3, t, size=11.5, color=WHITE, bold=True)
    txt(s, 1.45, y + 0.22, 4.6, 0.34, d, size=9, color=GREY, line=1.25)
    y += 0.55
panel(s, 6.6, 2.35, 5.85, 3.42, fill=INK_2, line_col=LINE)
txt(s, 6.85, 2.55, 5.4, 0.32, "WHAT THE CLOUD SUPPLIES ROADASSIST", size=10.5,
    color=BLUE, bold=True, spacing=1.8)
node(s, 8.4, 2.98, 2.25, 0.5, "CLOUD", color=BLUE, tsize=12.5)
for t, d, gx, gy, c in [("COMPUTE", "API + AI diagnosis", 6.85, 3.72, BLUE),
                        ("STORAGE", "PostgreSQL + PostGIS", 9.7, 3.72, CYAN),
                        ("NETWORK", "HTTPS + tile proxy", 6.85, 4.5, CYAN),
                        ("SERVICES", "auth · booking · SOS", 9.7, 4.5, GREEN),
                        ("DATA", "61 tables · audit chain", 8.28, 5.28, GREEN)]:
    node(s, gx, gy, 2.5, 0.66, t, d, color=c, tsize=10.5, ssize=8.5)
arrow(s, 9.3, 3.5, 8.1, 3.7, color=BLUE, width=1.1)
arrow(s, 9.75, 3.5, 10.9, 3.7, color=BLUE, width=1.1)
txt(s, 0.85, 5.95, 11.6, 0.6,
    "Cloud computing grew out of utility computing, grid computing and virtualisation. "
    "RoadAssist consumes it the way a home consumes electricity: on demand, metered, without owning the plant.",
    size=12, color=GREY, line=1.4)
module_rail(s, 1); page_no(s, 5)
notes(s, """MEANING
The five essential characteristics, each tied to something concrete, plus the five resource categories the cloud supplies.

SAY
"Cloud computing has five essential characteristics. On-demand self-service - a customer books assistance without anyone provisioning a thing. Broad network access - it is a Progressive Web App, so any phone browser reaches it. Resource pooling - one platform serves every customer and mechanic. Rapid elasticity - demand is not steady; monsoon and festival travel spike it. Measured service - usage is observable per request."

CONCEPT DEMONSTRATED
Module 1 - origins and influences, basic concepts and terminology, cloud characteristics.

RELATION TO ROADASSIST
Storage is genuinely PostgreSQL 16 with PostGIS 3.4.3. The data layer is 61 tables, including a hash-chained tamper-evident audit log.

IF ASKED
"Which characteristic is weakest in your build?" - Honestly, rapid elasticity. The application is designed to scale horizontally because request handling is stateless behind a JWT, but automatic scaling is not implemented. I label that rather than claim it.

TRANSITION
"Next - who actually plays which role in this picture."
""")
