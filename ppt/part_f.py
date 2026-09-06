

# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 22 — M4 ELASTIC DISK + REDUNDANT STORAGE
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "STORAGE THAT GROWS WITH THE SYSTEM",
            eyebrow="MODULE 4 · ELASTIC DISK PROVISIONING + REDUNDANT STORAGE",
            size=29, badge=ARCH)
txt(s, 0.85, 2.3, 5.5, 0.3, "ELASTIC DISK PROVISIONING", size=11, color=CYAN,
    bold=True, spacing=1.6)
node(s, 0.85, 2.7, 5.5, 0.58, "DATA ARRIVES", "bookings · detections · documents · audit",
     color=GREEN, tsize=11, ssize=8.5)
arrow(s, 3.6, 3.3, 3.6, 3.5, color=CYAN, width=1.3)
node(s, 0.85, 3.52, 5.5, 0.58, "STORAGE POOL", "allocated on demand, billed on use",
     color=CYAN, tsize=11, ssize=8.5)
arrow(s, 3.6, 4.12, 3.6, 4.32, color=CYAN, width=1.3)
for i, (lab, w_) in enumerate([("MONTH 1", 1.4), ("MONTH 6", 2.7), ("MONTH 12", 4.2)]):
    bar = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.85),
                             Inches(4.35 + i * 0.52), Inches(w_), Inches(0.4))
    bar.adjustments[0] = 0.25
    bar.fill.solid(); bar.fill.fore_color.rgb = CYAN
    bar.line.fill.background(); bar.shadow.inherit = False
    txt(s, 0.95, 4.42 + i * 0.52, 1.3, 0.26, lab, size=8.5, color=INK, bold=True)
txt(s, 0.85, 5.98, 5.5, 0.6,
    "Capacity follows actual growth rather than being bought up-front for a size nobody can predict.",
    size=9.5, color=GREY, line=1.3)
txt(s, 6.85, 2.3, 5.6, 0.3, "REDUNDANT STORAGE", size=11, color=RED, bold=True, spacing=1.6)
node(s, 6.85, 2.7, 2.55, 0.72, "PRIMARY", "authoritative", color=GREEN, tsize=11, ssize=8.5)
node(s, 9.9, 2.7, 2.55, 0.72, "REPLICA", "synchronised copy", color=CYAN, tsize=11, ssize=8.5)
arrow(s, 9.42, 3.06, 9.88, 3.06, color=AMBER, width=1.3, dashed=True)
arrow(s, 9.88, 3.24, 9.42, 3.24, color=AMBER, width=1.0, dashed=True)
what = [("Vehicle information", "registrations, class, documents"),
        ("Booking records", "state history, offers, invoices"),
        ("Service records", "completed work, reviews, ratings"),
        ("Audit information", "hash-chained, must survive intact"),
        ("RAKSHA operational data", "detections, road health, devices")]
y = 3.68
for t, d in what:
    chip(s, 6.85, y + 0.04, 0.18, 0.18, "", color=RED, fill=RED)
    txt(s, 7.15, y - 0.02, 5.3, 0.26, t, size=10.5, color=WHITE, bold=True)
    txt(s, 7.15, y + 0.21, 5.3, 0.24, d, size=8.5, color=GREY)
    y += 0.5
txt(s, 6.85, 6.18, 5.6, 0.32,
    "The audit chain is the strongest case: it is legally meaningful only if it cannot be lost.",
    size=9.5, color=GREY, line=1.3)
panel(s, 0.85, 6.62, 11.6, 0.34, fill=INK_2, line_col=AMBER, line_w=1.0)
txt(s, 1.05, 6.68, 11.2, 0.26,
    "Current implementation: one PostgreSQL instance with a fixed local volume. Both architectures on this slide are target state.",
    size=9, color=AMBER)
module_rail(s, 4); page_no(s, 22)
notes(s, """MEANING
Storage elasticity on the left, storage redundancy on the right, with the honest current state at the foot.

SAY
"Elastic disk provisioning means storage capacity is allocated as data actually arrives and billed on use, rather than bought up-front at a size nobody can predict. Redundant storage means a synchronised replica exists so a failure of the primary does not lose the data. For us the strongest case for redundancy is the audit chain - it is only legally meaningful if it cannot be lost."

CONCEPT DEMONSTRATED
Module 4 - elastic disk provisioning architecture and redundant storage architecture.

RELATION TO ROADASSIST
Today: one PostgreSQL instance on a fixed local Docker volume. Both are target state and the band says so.

IF ASKED
"What is elastic disk provisioning?" - Storage allocated dynamically as needed and charged by actual consumption, instead of a fixed pre-purchased volume.

IF ASKED
"What is redundant storage?" - Keeping duplicate copies of data on separate devices or locations, so that a hardware failure or site loss does not destroy it. It is about durability and availability, and it is distinct from backup, which is about recovering an earlier point in time.

TRANSITION
"Finally, how the cloud is operated day to day."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 23 — M4 CLOUD OPERATIONS
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "OPERATING THE CLOUD",
            eyebrow="MODULE 4 · MIGRATION · STATIC AND DYNAMIC SCHEDULING",
            size=32, badge=ARCH)
cols = [("MIGRATION", BLUE,
         "Moving a workload or resource from one host to another — for maintenance, "
         "consolidation, cost, or to recover from a failing node.",
         [("Source host", GREY_DIM), ("workload moves", BLUE), ("Target host", GREEN)]),
        ("STATIC SCHEDULING", CYAN,
         "Allocation decided in advance and held. Predictable, simple to reason about, "
         "but blind to what actually happens at runtime.",
         [("Plan fixed ahead", CYAN), ("Slot 1 · Slot 2 · Slot 3", GREY_DIM),
          ("Unchanged under load", CYAN)]),
        ("DYNAMIC SCHEDULING", GREEN,
         "Allocation recomputed as demand changes. Higher utilisation, at the cost of "
         "needing live measurement to decide on.",
         [("Observe demand", GREEN), ("Recompute placement", AMBER),
          ("Rebalance workloads", GREEN)])]
x = 0.85
for title_, c, desc, steps_ in cols:
    panel(s, x, 2.4, 3.7, 3.85, fill=INK_2, line_col=c, line_w=1.3)
    txt(s, x + 0.25, 2.58, 3.2, 0.3, title_, size=12.5, color=c, bold=True,
        spacing=1.5, font=SANS_SEMI)
    txt(s, x + 0.25, 2.92, 3.2, 0.95, desc, size=9.5, color=GREY, line=1.35)
    yy = 4.05
    for lab, sc in steps_:
        node(s, x + 0.25, yy, 3.2, 0.5, lab, color=sc, tsize=9.5)
        if yy < 5.0:
            arrow(s, x + 1.85, yy + 0.52, x + 1.85, yy + 0.68, color=sc, width=1.1)
        yy += 0.7
    x += 3.95
panel(s, 0.85, 6.4, 11.6, 0.42, fill=INK_2, line_col=CYAN, line_w=1.0)
txt(s, 1.05, 6.48, 11.2, 0.3,
    "Closest real analogue in the project: dispatch is a scheduler. It observes which mechanics are available and where, then allocates a job — a dynamic scheduling decision at application level.",
    size=9.5, color=CYAN)
module_rail(s, 4); page_no(s, 23)
notes(s, """MEANING
The three cloud operations, each as a small vertical flow, with a genuine application-level analogue at the foot.

SAY
"Three operations. Migration moves a workload from one host to another - for maintenance, consolidation, cost, or to escape a failing node. Static scheduling decides allocation in advance and holds it: predictable, but blind to runtime reality. Dynamic scheduling recomputes as demand changes: better utilisation, but it needs live measurement to decide on - which is exactly why the usage monitor from Module 3 matters."

CONCEPT DEMONSTRATED
Module 4 - cloud operations: migration, static scheduling, dynamic scheduling.

RELATION TO ROADASSIST
There is a real analogue. Our dispatch engine is a scheduler: it queries PostGIS for available mechanics near the breakdown, ranks them by rating, distance and experience, and allocates the job. That is a dynamic scheduling decision made on live state - just at application level rather than infrastructure level.

IF ASKED
"What is the difference between static and dynamic scheduling?" - Static fixes the allocation before execution and does not revisit it; dynamic re-evaluates during execution using current load. Static is cheaper to run and easier to predict; dynamic gets better utilisation.

IF ASKED
"Give an example of migration in your system." - Not implemented at infrastructure level. Conceptually, moving the database container to a larger host during a festival period, with the application unchanged because it addresses the database by connection string, not location.

TRANSITION
"Let me now put every layer together in one architecture."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 24 — COMPLETE CLOUD ARCHITECTURE
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_CLEAN)
title_block(s, "ROADASSIST BHARAT — CLOUD ARCHITECTURE",
            eyebrow="THE COMPLETE PICTURE", size=30)
lay = [("CLIENTS", ["CUSTOMER PWA", "MECHANIC CONSOLE", "AUTHORITY DASHBOARD", "PUBLIC SITE"],
        GREEN, 2.3, IMPL),
       ("API / WEB SERVICES", ["FASTIFY · 58 ROUTES · JSON · SCHEMA-VALIDATED"], BLUE, 3.05, IMPL),
       ("PLATFORM SERVICES", ["AUTH", "BOOKING", "AI", "MAP", "RAKSHA", "PAYMENT", "NOTIFY", "SYNC"],
        CYAN, 3.8, IMPL),
       ("COMPUTE / VIRTUAL RESOURCES", ["STATELESS API INSTANCES  ·  CONTAINERISED SERVICES"],
        AMBER, 4.55, PART),
       ("STORAGE / DATABASE", ["POSTGRESQL 16 + POSTGIS 3.4.3  ·  61 TABLES  ·  AUDIT CHAIN"],
        CYAN, 5.3, IMPL),
       ("CLOUD INFRASTRUCTURE", ["PROVIDER ESTATE — DATA CENTRE · HYPERVISOR · NETWORK · STORAGE"],
        GREY_DIM, 6.05, ARCH)]
# The layer name lives in the left gutter and the status badge on the right.
# The cross-cutting architectures run along the foot rather than down the left,
# where they used to sit on top of the layer names.
LAY_Y0, LAY_STEP, LAY_H = 1.95, 0.71, 0.6
for idx, (name, items, c, _old_y, badge) in enumerate(lay):
    y = LAY_Y0 + idx * LAY_STEP
    panel(s, 2.75, y, 7.9, LAY_H, fill=INK_2, line_col=c, line_w=1.2)
    txt(s, 0.85, y + 0.13, 1.75, 0.36, name, size=8.5, color=c, bold=True,
        spacing=1.0, align=PP_ALIGN.RIGHT, line=1.12)
    if len(items) == 1:
        txt(s, 2.9, y + 0.18, 7.6, 0.3, items[0], size=9.5, color=WHITE,
            align=PP_ALIGN.CENTER, bold=True, font=MONO)
    else:
        wid = 7.7 / len(items)
        for i, it in enumerate(items):
            chip(s, 2.85 + i * wid, y + 0.13, wid - 0.09, 0.34, it,
                 color=c, size=(7 if len(items) > 4 else 8.5), fill=INK_3)
    chip(s, 10.85, y + 0.15, 1.6, 0.3, badge[0].split(" /")[0].split(" ")[0],
         color=badge[1], size=7, fill=INK)
    if idx < len(lay) - 1:
        arrow(s, 6.7, y + LAY_H + 0.01, 6.7, y + LAY_STEP - 0.01,
              color=GREY_DIM, width=1.1)
txt(s, 0.85, 6.29, 11.6, 0.28, "CROSS-CUTTING CLOUD ARCHITECTURES — MODULE 4",
    size=8.5, color=GREY_DIM, bold=True, spacing=1.8)
side = [("SECURITY BOUNDARY", RED), ("LOAD BALANCING", BLUE), ("RESOURCE POOLING", CYAN),
        ("MONITORING", AMBER), ("SCALABILITY", GREEN), ("REPLICATION", CYAN)]
for i, (t, c) in enumerate(side):
    chip(s, 0.85 + i * 1.95, 6.6, 1.82, 0.36, t, color=c, size=7.5, fill=INK)
page_no(s, 24)
txt(s, 0.85, 7.08, 9.5, 0.28,
    "Right-hand badges give the honest status of each layer.",
    size=8, color=GREY_DIM)
notes(s, """MEANING
The single most important technical slide. Six layers top to bottom, cross-cutting architectures down the left, and a status badge on every layer.

SAY
"This is the whole system in one picture. At the top, four client surfaces - all built. Below them, the Fastify API with 58 schema-validated routes. Below that, eight platform services. Then compute, which I mark partial because it is containerised but not orchestrated. Then storage - PostgreSQL with PostGIS, 61 tables and the audit chain. And at the base the cloud infrastructure, which belongs to the provider. Down the left are the cross-cutting concerns from Module 4 that wrap every layer."

CONCEPT DEMONSTRATED
Integration of all four modules - this is where they meet.

RELATION TO ROADASSIST
Every layer marked IMPLEMENTED can be demonstrated live right now.

IF ASKED
"Walk me through a single request." - A customer taps Request Assistance. HTTPS to the API. Schema validation. Token verified, role checked, then vehicle ownership checked at the resource. The booking service creates a record and the state machine moves it from DRAFT to REQUESTED. Dispatch queries PostGIS for nearby available mechanics and ranks them. Offers are written. The response returns. Every step is logged with a request id.

TRANSITION
"And this is what that architecture delivers to a stranded driver."
""")
