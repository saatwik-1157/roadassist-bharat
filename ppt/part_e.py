

# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 18 — M4 INTRO
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "MODULE 4 — FUNDAMENTAL CLOUD ARCHITECTURES",
            eyebrow="EIGHT ARCHITECTURES + CLOUD OPERATIONS", size=28, badge=ARCH)
panel(s, 4.6, 3.75, 4.1, 1.3, fill=INK_3, line_col=BLUE, line_w=1.7)
txt(s, 4.75, 4.0, 3.8, 0.35, "ROADASSIST BHARAT", size=15, color=WHITE, bold=True,
    align=PP_ALIGN.CENTER, font=SANS_SEMI)
txt(s, 4.75, 4.4, 3.8, 0.45, "as a cloud architecture",
    size=10.5, color=CYAN, align=PP_ALIGN.CENTER)
around = [("WORKLOAD\nDISTRIBUTION", 0.85, 2.5, CYAN), ("RESOURCE\nPOOLING", 3.65, 2.5, CYAN),
          ("DYNAMIC\nSCALABILITY", 6.55, 2.5, GREEN), ("ELASTIC\nCAPACITY", 9.45, 2.5, GREEN),
          ("SERVICE LOAD\nBALANCING", 0.85, 5.5, BLUE), ("CLOUD\nBURSTING", 3.65, 5.5, AMBER),
          ("ELASTIC DISK\nPROVISIONING", 6.55, 5.5, AMBER), ("REDUNDANT\nSTORAGE", 9.45, 5.5, RED)]
for t, ax, ay, c in around:
    node(s, ax, ay, 2.55, 0.95, t, color=c, tsize=10.5)
    if ay < 4:
        arrow(s, ax + 1.27, ay + 0.97, 6.65, 3.73, color=c, width=1.0)
    else:
        arrow(s, 6.65, 5.07, ax + 1.27, ay - 0.02, color=c, width=1.0)
txt(s, 0.85, 6.62, 11.6, 0.32,
    "Plus cloud operations: migration, static scheduling and dynamic scheduling — covered on slide 23.",
    size=10, color=GREY, align=PP_ALIGN.CENTER)
module_rail(s, 4); page_no(s, 18)
notes(s, """MEANING
The major transition slide. RoadAssist sits at the centre, surrounded by the eight fundamental architectures.

SAY
"Module 4 defines the fundamental cloud architectures. Eight of them surround the platform here: workload distribution, resource pooling, dynamic scalability, elastic resource capacity, service load balancing, cloud bursting, elastic disk provisioning and redundant storage. Plus cloud operations - migration and scheduling - which I cover separately. Over the next five slides I take these in pairs and show what each would mean for RoadAssist specifically."

CONCEPT DEMONSTRATED
Module 4 - the complete set of fundamental cloud architectures.

RELATION TO ROADASSIST
These are architectures the platform is designed to accept rather than ones it currently runs. The design decisions that make them possible - statelessness, a single data layer, idempotent operations - are implemented.

IF ASKED
"Which of these eight do you implement?" - None as running infrastructure, and I say so plainly. What I did implement are the application properties that make them adoptable without a rewrite: stateless request handling, idempotency keys, and server-authoritative state.

TRANSITION
"Starting with the two that govern how work is spread."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 19 — M4 WORKLOAD DISTRIBUTION + RESOURCE POOLING
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "DISTRIBUTE WORK. SHARE RESOURCES.",
            eyebrow="MODULE 4 · WORKLOAD DISTRIBUTION + RESOURCE POOLING",
            size=30, badge=ARCH)
txt(s, 0.85, 2.3, 5.5, 0.3, "WORKLOAD DISTRIBUTION", size=11, color=CYAN, bold=True, spacing=1.6)
reqs = [("AI diagnosis", CYAN), ("Booking", GREEN), ("Map tiles", BLUE),
        ("Mechanic poll", BLUE), ("SOS", RED)]
for i, (r, c) in enumerate(reqs):
    chip(s, 0.85, 2.72 + i * 0.44, 1.85, 0.36, r, color=c, size=9, fill=INK_2)
    arrow(s, 2.74, 2.9 + i * 0.44, 3.35, 3.85, color=c, width=1.0)
node(s, 3.35, 3.6, 2.5, 0.62, "DISTRIBUTION LOGIC", "route by type and load",
     color=WHITE, tsize=10.5, ssize=8.5)
for i in range(3):
    node(s, 3.35, 4.5 + i * 0.62, 2.5, 0.52, f"WORKER {i + 1}", color=BLUE, tsize=10)
    arrow(s, 4.6, 4.24, 4.6, 4.48 + i * 0.62, color=BLUE, width=1.0)
txt(s, 6.6, 2.3, 5.85, 0.3, "RESOURCE POOLING", size=11, color=GREEN, bold=True, spacing=1.6)
panel(s, 6.6, 2.72, 5.85, 2.15, fill=INK_2, line_col=GREEN, line_w=1.3)
txt(s, 6.8, 2.88, 5.4, 0.28, "SHARED POOL", size=10.5, color=GREEN, bold=True)
pool = [("COMPUTE", "API + AI workers", BLUE), ("STORAGE", "database + uploads", CYAN),
        ("NETWORK", "bandwidth + tile cache", CYAN), ("SERVICES", "auth · booking · map", GREEN)]
for i, (t, d, c) in enumerate(pool):
    px = 6.8 + (i % 2) * 2.9
    py = 3.24 + (i // 2) * 0.75
    node(s, px, py, 2.7, 0.62, t, d, color=c, tsize=10, ssize=8)
txt(s, 6.6, 5.0, 5.85, 0.85,
    "One pool serves every tenant and every request type. A map-tile burst and an AI diagnosis draw on the "
    "same underlying capacity, which is exactly why pooling improves utilisation over dedicated allocation.",
    size=10, color=GREY, line=1.35)
panel(s, 0.85, 6.28, 11.6, 0.5, fill=INK_2, line_col=GREEN, line_w=1.0)
txt(s, 1.05, 6.38, 11.2, 0.32,
    "Implemented today in a limited form: the map tile proxy keeps a shared in-memory tile cache, so one user's fetch serves the next user's request.",
    size=9.5, color=GREEN)
module_rail(s, 4); page_no(s, 19)
notes(s, """MEANING
Two architectures side by side: distributing incoming work, and pooling the resources that work draws on.

SAY
"Workload distribution routes incoming requests across multiple workers. On the left are our five real request types - AI diagnosis, booking, map tiles, mechanic polling and SOS - which have genuinely different shapes. Map tiles are bursty and cacheable; SOS is rare but must never wait. On the right, resource pooling means those all draw on one shared pool of compute, storage, network and services rather than each having dedicated capacity."

CONCEPT DEMONSTRATED
Module 4 - workload distribution architecture and resource pooling architecture.

RELATION TO ROADASSIST
There is a genuine, if small, instance of pooling already: the map tile proxy maintains a shared in-memory cache, so a tile fetched for one user is served from memory to the next. That is resource pooling at application scale.

IF ASKED
"What is resource pooling?" - Grouping computing resources so they serve multiple consumers from a common pool, assigned on demand, rather than dedicating fixed capacity to each. It raises utilisation, because peaks in one workload use capacity another is not using.

IF ASKED
"How would you distribute SOS differently?" - SOS should be prioritised, not just distributed. In a queue-based design it would take a dedicated high-priority path so a surge of map requests could never delay an emergency.

TRANSITION
"Distribution assumes fixed capacity. Scalability changes the capacity itself."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 20 — M4 DYNAMIC SCALABILITY + ELASTIC CAPACITY
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "THE CLOUD ADAPTS TO DEMAND.",
            eyebrow="MODULE 4 · DYNAMIC SCALABILITY + ELASTIC RESOURCE CAPACITY",
            size=31, badge=ARCH)
phases = [("LOW", 1, GREY_DIM, "Night · few journeys"),
          ("NORMAL", 2, CYAN, "Weekday commute"),
          ("HIGH", 4, BLUE, "Monsoon · poor roads"),
          ("PEAK", 6, RED, "Festival travel"),
          ("LOW", 1, GREY_DIM, "Demand recedes")]
x = 0.85
for i, (lab, n, c, note_) in enumerate(phases):
    txt(s, x, 2.4, 2.2, 0.28, lab, size=11.5, color=c, bold=True, spacing=1.6,
        align=PP_ALIGN.CENTER)
    txt(s, x, 2.66, 2.2, 0.28, note_, size=8.5, color=GREY_DIM, align=PP_ALIGN.CENTER)
    for k in range(n):
        sv = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                Inches(x + 0.45 + (k % 3) * 0.44),
                                Inches(4.55 - (k // 3) * 0.52),
                                Inches(0.36), Inches(0.44))
        sv.adjustments[0] = 0.2
        sv.fill.solid(); sv.fill.fore_color.rgb = c
        sv.line.fill.background(); sv.shadow.inherit = False
    txt(s, x, 5.12, 2.2, 0.26, f"{n} instance{'s' if n > 1 else ''}", size=9,
        color=c, align=PP_ALIGN.CENTER, font=MONO)
    if i < 4:
        arrow(s, x + 2.24, 4.6, x + 2.42, 4.6, color=GREY_DIM, width=1.1)
    x += 2.45
sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.85), Inches(5.5),
                        Inches(11.6), Inches(0.02))
sh.fill.solid(); sh.fill.fore_color.rgb = LINE; sh.line.fill.background()
sh.shadow.inherit = False
txt(s, 0.85, 5.65, 5.5, 0.3, "DYNAMIC SCALABILITY", size=10.5, color=GREEN,
    bold=True, spacing=1.5)
txt(s, 0.85, 5.9, 5.5, 0.55,
    "Instances are added and removed automatically as measured demand crosses thresholds.",
    size=9.5, color=GREY, line=1.3)
txt(s, 6.85, 5.65, 5.6, 0.3, "ELASTIC RESOURCE CAPACITY", size=10.5, color=CYAN,
    bold=True, spacing=1.5)
txt(s, 6.85, 5.9, 5.6, 0.55,
    "Existing instances are resized — more CPU and memory allocated to the same server.",
    size=9.5, color=GREY, line=1.3)
panel(s, 0.85, 6.42, 11.6, 0.4, fill=INK_2, line_col=AMBER, line_w=1.0)
txt(s, 1.05, 6.5, 11.2, 0.28,
    "Architectural capability. RoadAssist does NOT implement automatic scaling. It is written to accept it: request handling is stateless, so instances are interchangeable.",
    size=9.5, color=AMBER)
module_rail(s, 4); page_no(s, 20)
notes(s, """MEANING
A demand timeline with instance count rising and falling, and the precise distinction between the two architectures.

SAY
"Demand on a roadside assistance platform is not steady. Night is quiet. Weekday commuting is normal. Monsoon brings poor road conditions and more breakdowns. Festival travel is the peak. Then it recedes. Dynamic scalability adds and removes whole instances as demand crosses thresholds. Elastic resource capacity instead resizes the instances you already have - more CPU and memory to the same server. Scaling out versus scaling up."

CONCEPT DEMONSTRATED
Module 4 - dynamic scalability architecture and elastic resource capacity architecture.

RELATION TO ROADASSIST
I state clearly that automatic scaling is not implemented. What is implemented is the property that makes it possible: the session lives in a JWT the client presents, so no instance holds user state and any instance can serve any request.

IF ASKED
"What is the difference between dynamic scalability and elastic capacity?" - Dynamic scalability changes the NUMBER of resources - horizontal, scale out. Elastic resource capacity changes the SIZE of existing resources - vertical, scale up. Scaling out generally suits stateless web workloads; scaling up suits a database that is hard to shard.

IF ASKED
"Have you implemented autoscaling?" - No. Claiming it would be false and easily checked. The design decisions that permit it are done.

TRANSITION
"Adding instances only helps if traffic is spread across them."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 21 — M4 LOAD BALANCING + CLOUD BURSTING
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "KEEPING SERVICES RESPONSIVE UNDER LOAD",
            eyebrow="MODULE 4 · SERVICE LOAD BALANCING + CLOUD BURSTING",
            size=30, badge=ARCH)
txt(s, 0.85, 2.3, 5.5, 0.3, "SERVICE LOAD BALANCING", size=11, color=BLUE, bold=True, spacing=1.6)
for i in range(4):
    chip(s, 0.85 + i * 0.75, 2.72, 0.66, 0.34, "USER", color=GREEN, size=7, fill=INK_2)
    arrow(s, 1.18 + i * 0.75, 3.08, 3.1, 3.42, color=GREEN, width=0.9)
node(s, 1.6, 3.45, 3.0, 0.6, "LOAD BALANCER", "even distribution + health checks",
     color=BLUE, tsize=11, ssize=8)
for i in range(3):
    node(s, 0.85 + i * 1.6, 4.35, 1.45, 0.75, f"SERVER {i + 1}", color=CYAN, tsize=9.5)
    arrow(s, 3.1, 4.07, 1.57 + i * 1.6, 4.33, color=CYAN, width=1.0)
txt(s, 0.85, 5.28, 5.5, 0.6,
    "The balancer also removes an unhealthy instance from rotation, which is how load balancing "
    "contributes to availability, not only to throughput.",
    size=9.5, color=GREY, line=1.3)
txt(s, 6.85, 2.3, 5.6, 0.3, "CLOUD BURSTING", size=11, color=AMBER, bold=True, spacing=1.6)
panel(s, 6.85, 2.72, 5.6, 1.05, fill=INK_2, line_col=GREEN, line_w=1.2)
txt(s, 7.05, 2.88, 5.2, 0.28, "PRIMARY ENVIRONMENT", size=10.5, color=GREEN, bold=True)
txt(s, 7.05, 3.14, 5.2, 0.5, "Baseline capacity — private or on-premises. Handles normal demand.",
    size=9, color=GREY, line=1.25)
panel(s, 6.85, 3.9, 5.6, 0.42, fill=INK_3, line_col=RED, line_w=1.2)
txt(s, 7.05, 3.98, 5.2, 0.28, "CAPACITY LIMIT REACHED", size=10, color=RED,
    bold=True, align=PP_ALIGN.CENTER, spacing=1.4)
arrow(s, 9.65, 4.35, 9.65, 4.58, color=AMBER, width=1.4, dashed=True)
panel(s, 6.85, 4.6, 5.6, 1.05, fill=INK_2, line_col=AMBER, line_w=1.2)
txt(s, 7.05, 4.76, 5.2, 0.28, "ADDITIONAL PUBLIC CLOUD CAPACITY", size=10.5,
    color=AMBER, bold=True)
txt(s, 7.05, 5.02, 5.2, 0.5, "Overflow only, released when the peak passes. Pay for the burst, not the year.",
    size=9, color=GREY, line=1.25)
txt(s, 6.85, 5.78, 5.6, 0.5,
    "Natural fit: a festival weekend or a regional weather event is exactly a short, predictable burst.",
    size=9.5, color=GREY, line=1.3)
panel(s, 0.85, 6.42, 11.6, 0.4, fill=INK_2, line_col=AMBER, line_w=1.0)
txt(s, 1.05, 6.5, 11.2, 0.28,
    "Neither is currently implemented. RoadAssist runs a single API process behind an HTTPS tunnel for demonstration; both are described as target architecture.",
    size=9.5, color=AMBER)
module_rail(s, 4); page_no(s, 21)
notes(s, """MEANING
Load balancing on the left, cloud bursting on the right, with an unambiguous honesty band.

SAY
"A load balancer spreads incoming requests evenly across instances and, just as importantly, health-checks them - an unhealthy server is removed from rotation, so load balancing serves availability as well as throughput. Cloud bursting is different: you run a baseline private environment, and when it hits its capacity limit you overflow into public cloud capacity temporarily, releasing it afterwards. For us the natural trigger is a festival weekend or a regional weather event - a short, fairly predictable burst."

CONCEPT DEMONSTRATED
Module 4 - service load balancing architecture and cloud bursting architecture.

RELATION TO ROADASSIST
Neither is implemented, and the band says so. Today there is one API process reached through an HTTPS tunnel.

IF ASKED
"What is cloud bursting?" - A hybrid pattern where an organisation runs its normal load on private infrastructure and temporarily 'bursts' into public cloud when demand exceeds that baseline, then releases the extra capacity.

IF ASKED
"Why is bursting attractive here?" - Because our peaks are short and event-driven. Buying permanent capacity for a few festival weekends is wasteful; renting it for those days is not.

TRANSITION
"Compute scales - but so must storage."
""")
