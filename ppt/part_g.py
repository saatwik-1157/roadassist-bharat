

# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 25 — COMPLETE USER JOURNEY
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_DEEP)
title_block(s, "FROM BREAKDOWN TO RESOLUTION",
            eyebrow="THE COMPLETE USER JOURNEY", size=32, badge=IMPL)
journey = [("LOGIN", "OTP · JWT", GREEN), ("VEHICLE", "select / add", GREEN),
           ("AI DIAGNOSIS", "rules engine", CYAN), ("REQUEST", "guided, 5 steps", CYAN),
           ("MECHANIC MATCH", "PostGIS + ranker", BLUE), ("BOOKING", "state machine", BLUE),
           ("LIVE TRACKING", "distance + ETA", BLUE), ("SERVICE", "mechanic drives it", AMBER),
           ("PAYMENT", "invoice-derived", GREEN), ("REVIEW", "feeds the ranker", GREEN)]
x = 0.85
for i, (t, d, c) in enumerate(journey):
    col = i % 5
    row = i // 5
    px = 0.85 + col * 2.42
    py = 2.5 + row * 1.32
    node(s, px, py, 2.25, 0.95, t, d, color=c, tsize=10.5, ssize=8.5)
    if col < 4:
        arrow(s, px + 2.27, py + 0.48, px + 2.4, py + 0.48, color=GREY_DIM, width=1.0)
    elif row == 0:
        arrow(s, px + 1.12, py + 0.97, px + 1.12, py + 1.3, color=GREY_DIM, width=1.0)
panel(s, 0.85, 5.2, 11.6, 0.92, fill=INK_3, line_col=BLUE, line_w=1.4)
txt(s, 1.05, 5.34, 11.2, 0.3, "SUPPORTED AT EVERY STEP BY THE CLOUD PLATFORM",
    size=11, color=WHITE, bold=True, align=PP_ALIGN.CENTER, spacing=1.6)
for i, (t, c) in enumerate([("Compute", BLUE), ("Storage", CYAN), ("Network", CYAN),
                            ("Services", GREEN), ("Security", RED), ("Monitoring", AMBER)]):
    chip(s, 1.05 + i * 1.9, 5.68, 1.8, 0.34, t, color=c, size=8.5, fill=INK_2)
txt(s, 0.85, 6.28, 11.6, 0.42,
    "Verified end to end by an automated browser suite driving this exact journey across both applications — "
    "115 browser assertions, plus 165 API, 26 security and 22 payment-gateway assertions.",
    size=10, color=GREY, line=1.3)
footer(s); page_no(s, 25)
notes(s, """MEANING
The full ten-step journey, and the honest claim that it is automatically tested end to end.

SAY
"This is the journey the platform actually delivers. Login by OTP. Select a vehicle. AI diagnosis names a likely cause. A guided five-step request. Mechanic matching using PostGIS and a deterministic ranker. A booking governed by the state machine. Live tracking with distance and ETA. The mechanic drives the job. Payment derived from the invoice, never from the client. And a review, which feeds back into the ranker that chooses who gets dispatched next time."

CONCEPT DEMONSTRATED
The cloud platform as the enabler of every step - the synthesis of all four modules in one user-visible flow.

RELATION TO ROADASSIST
This whole flow is covered by an automated browser test suite: 115 browser assertions driving both applications, plus 165 API assertions, 26 security assertions and 22 payment-gateway assertions. 345 in total, all passing.

IF ASKED
"Is the review loop real?" - Yes, and it closes properly. The dispatch ranker weights a mechanic's rating at 34 percent of their score, and a review recomputes that rating from the actual review rows, shrunk toward the platform mean so a single rating cannot make or break someone.

TRANSITION
"So, to close."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 26 — FINAL IMPACT
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_HERO)
txt(s, 0.9, 2.15, 8.6, 1.7,
    "WHEN THE ROAD STOPS,\nROADASSIST BHARAT\nKEEPS YOU MOVING.",
    size=40, color=WHITE, bold=True, font=SANS_SEMI, line=1.12)
bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.9), Inches(4.15),
                         Inches(1.5), Inches(0.05))
bar.fill.solid(); bar.fill.fore_color.rgb = BLUE; bar.line.fill.background()
bar.shadow.inherit = False
txt(s, 0.9, 4.45, 8.0, 0.5, "AI  +  CLOUD  +  MOBILITY  +  SAFETY",
    size=20, color=CYAN, bold=True, spacing=3.2, font=SANS_SEMI)
for i, (t, c) in enumerate([("AI", CYAN), ("CLOUD", BLUE), ("MAP", BLUE),
                            ("MECHANIC", GREEN), ("RAKSHA", RED), ("SAFETY", GREEN)]):
    chip(s, 0.9 + i * 1.28, 5.35, 1.16, 0.36, t, color=c, size=8.5)
txt(s, 0.9, 6.05, 8.2, 0.4,
    "A working platform, used to demonstrate Cloud Computing Modules 1 through 4.",
    size=12, color=GREY, italic=True)
visual(s, 9.35, 2.0, 3.1, 4.2, str(ASSETS / "vis_closing.png"), "close")
page_no(s, 26)
notes(s, """MEANING
The closing frame. Deliberately quiet - one statement, one equation, nothing else competing.

SAY
"When the road stops, RoadAssist Bharat keeps you moving. AI, cloud, mobility and safety - four threads, one platform. And throughout this presentation I have tried to be precise about which parts are built and which are architecture, because I think that distinction is what makes the cloud analysis worth anything. Thank you - I am happy to take questions, and I can show the live system."

CONCEPT DEMONSTRATED
Synthesis.

RELATION TO ROADASSIST
Everything claimed as implemented can be demonstrated on request.

IF ASKED
"What would you do next?" - Three things in order: configure a read replica so the redundant storage architecture stops being theoretical; put the API behind a real load balancer with two instances; and move dispatch onto the event bus that is already provisioned but unused, which would let SOS take a priority path.

TRANSITION
"To the module mapping and questions."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 27 — ACADEMIC MODULE MAPPING (required)
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_CLEAN)
title_block(s, "ACADEMIC MODULE MAPPING",
            eyebrow="SWE4004 · SYLLABUS COVERAGE", size=32)
maps = [("MODULE 1", "UNDERSTANDING CLOUD COMPUTING", BLUE,
         "Origins and influences · basic concepts and terminology · goals and benefits · "
         "risks and challenges · roles and boundaries · cloud characteristics · "
         "delivery models (IaaS/PaaS/SaaS) · deployment models",
         "Slides 4, 5, 6, 7, 8"),
        ("MODULE 2", "CLOUD ENABLING TECHNOLOGY", CYAN,
         "Data center technology · virtualization technology · web technology · "
         "multitenant technology · service technology (Razorpay gateway integration)",
         "Slides 9, 10, 11, 12, 13"),
        ("MODULE 3", "CLOUD INFRASTRUCTURE MECHANISMS", GREEN,
         "Network perimeter · virtual server · cloud storage device · "
         "cloud usage monitor · resource replication",
         "Slides 14, 15, 16, 17, 18"),
        ("MODULE 4", "FUNDAMENTAL CLOUD ARCHITECTURES", AMBER,
         "Workload distribution · resource pooling · dynamic scalability · elastic resource capacity · "
         "service load balancing · cloud bursting · elastic disk provisioning · redundant storage · "
         "migration · static scheduling · dynamic scheduling",
         "Slides 19, 20, 21, 22, 23, 24")]
y = 2.35
for m, title_, c, topics, slides_ in maps:
    panel(s, 0.85, y, 11.6, 1.08, fill=INK_2, line_col=c, line_w=1.3)
    txt(s, 1.1, y + 0.14, 1.6, 0.3, m, size=13, color=c, bold=True, font=SANS_SEMI)
    txt(s, 1.1, y + 0.45, 1.9, 0.5, slides_, size=8.5, color=GREY_DIM, line=1.2)
    txt(s, 3.15, y + 0.13, 9.1, 0.3, title_, size=11.5, color=WHITE, bold=True, spacing=1.2)
    txt(s, 3.15, y + 0.42, 9.1, 0.6, topics, size=9.5, color=GREY, line=1.3)
    y += 1.16
txt(s, 0.85, 7.0, 11.6, 0.3,
    "Every syllabus topic from Modules 1-4 appears in the main narrative, not in an appendix.",
    size=9.5, color=CYAN, align=PP_ALIGN.CENTER)
page_no(s, 27)
notes(s, """MEANING
The required syllabus coverage map. Every Module 1-4 topic, with the slide numbers where it is treated.

SAY
"For completeness, this maps every syllabus topic to where it appears. Module 1 across slides 4 to 8. Module 2 across 9 to 12. Module 3 across 13 to 17. Module 4 across 18 to 23. The point I want to make is that these are not an appendix - they are the spine of the presentation. RoadAssist is the worked example throughout."

CONCEPT DEMONSTRATED
Complete syllabus coverage.

RELATION TO ROADASSIST
Every module was taught through the project rather than alongside it.

IF ASKED
"Which topic did you find hardest to map honestly?" - Cloud bursting. It is a genuinely useful pattern for our demand profile, but there was no honest way to claim any part of it exists, so I presented it purely as target architecture with the reasoning for why it fits.

TRANSITION
"And finally, a short reference of likely questions."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDES 28-30 — VIVA PREPARATION
# ═════════════════════════════════════════════════════════════════════════════
QA = [
    ("What is cloud computing?",
     "On-demand network access to a shared pool of configurable computing resources, "
     "provisioned and released with minimal management effort. RoadAssist consumes compute, "
     "storage and network this way rather than owning hardware."),
    ("Why does RoadAssist need cloud computing?",
     "Because the information a stranded driver needs is spread across parties and must be "
     "combined in real time, and because demand is uneven and geographically dispersed. "
     "One authoritative service reachable from any road is the requirement."),
    ("What are the characteristics of cloud computing?",
     "On-demand self-service, broad network access, resource pooling, rapid elasticity and "
     "measured service. Our PWA and booking flow demonstrate the first two directly."),
    ("What are IaaS, PaaS and SaaS?",
     "Infrastructure as a Service gives virtual machines and storage; Platform as a Service "
     "adds a managed runtime; Software as a Service delivers finished software. RoadAssist "
     "IS a SaaS application; IaaS and PaaS are how it would be hosted."),
    ("Difference between public, private and hybrid cloud?",
     "Public is shared provider infrastructure; private is dedicated to one organisation; "
     "hybrid combines both. Hybrid suits us: public for the citizen app, private for RAKSHA "
     "authority and medical data."),
    ("What is virtualization?",
     "Abstracting physical hardware so one machine presents itself as several isolated "
     "logical ones. We use OS-level virtualization - Docker containers - not a hypervisor "
     "we operate."),
    ("Why is virtualization useful?",
     "Consolidation, isolation and portability. Several workloads share one machine safely, "
     "and a workload can move between machines because it no longer depends on specific hardware."),
    ("What is multitenancy?",
     "One running instance serving multiple independent tenants with isolated data. Our "
     "tenants would be vehicle fleets and government jurisdictions; the schema exists and "
     "queries are scoped to the caller."),
    ("What is a virtual server?",
     "A software-defined server sharing physical hardware with others, allocated on demand "
     "and isolated from neighbours. Our API is stateless, so it could run on any number of them."),
    ("What is a network perimeter?",
     "The controlled boundary between untrusted networks and internal services. Ours layers "
     "TLS, rate limiting, schema validation, authentication, role gating and resource-level "
     "ownership checks."),
    ("What is cloud storage?",
     "Persistent, network-addressable storage provided as a service. Ours is PostgreSQL 16 "
     "with PostGIS - 61 tables including a hash-chained audit log."),
    ("What is resource replication?",
     "Creating multiple instances of a resource so load can be spread and a single failure "
     "does not lose the service. Not implemented for us - we run a single database instance."),
    ("What is cloud usage monitoring?",
     "Collecting runtime usage and performance data for billing, capacity planning and "
     "scaling decisions. We have a limited form: a health endpoint reporting database "
     "latency, and per-request logging."),
    ("What is workload distribution?",
     "Spreading incoming work across multiple resources so no single one is overwhelmed. "
     "Our five request types - AI, booking, map, polling, SOS - have very different shapes."),
    ("What is resource pooling?",
     "Grouping resources to serve many consumers from a common pool assigned on demand. "
     "Our shared map-tile cache is a small working example."),
    ("What is dynamic scalability?",
     "Automatically adding or removing resource INSTANCES as demand changes - scaling out. "
     "Not implemented; the stateless design permits it."),
    ("What is elastic resource capacity?",
     "Resizing existing resources - more CPU or memory to the same server - rather than "
     "adding instances. Scaling up rather than out."),
    ("What is load balancing?",
     "Distributing requests across instances and health-checking them, so an unhealthy "
     "instance leaves rotation. It serves availability as well as throughput."),
    ("What is cloud bursting?",
     "Running baseline load privately and overflowing into public cloud during peaks, then "
     "releasing it. Our festival and monsoon peaks are exactly this shape."),
    ("What is elastic disk provisioning?",
     "Storage allocated as data arrives and billed on use, rather than pre-purchased at a "
     "fixed size. Not implemented - we use a fixed local volume."),
    ("What is redundant storage?",
     "Duplicate copies on separate devices or sites so failure does not destroy data. "
     "Distinct from backup, which recovers an earlier point in time."),
    ("What is migration?",
     "Moving a workload or resource between hosts - for maintenance, consolidation, cost, "
     "or to escape a failing node."),
    ("What is static scheduling?",
     "Allocation decided in advance and held throughout execution. Predictable and cheap, "
     "but blind to actual runtime load."),
    ("How is the payment gateway integrated securely?",
     "The amount comes from the invoice, never the request; the key secret never "
     "leaves the server; and settlement requires an HMAC-SHA256 signature the "
     "server re-computes. A webhook settles even if the payer's browser never returns."),
    ("What is dynamic scheduling?",
     "Allocation recomputed during execution as demand changes. Our dispatch engine is a "
     "dynamic scheduler at application level: it ranks live mechanics by distance, rating "
     "and experience at request time."),
]

# Paged from the list length, so adding a question can never silently drop one.
PER_PAGE = 8
QA_PAGES = -(-len(QA) // PER_PAGE)
for page in range(QA_PAGES):
    s = new_slide(BG_CLEAN)
    title_block(s, "VIVA PREPARATION" if page == 0 else "VIVA PREPARATION  (cont.)",
                eyebrow=f"LIKELY QUESTIONS · {page + 1} OF {QA_PAGES}", size=30)
    block = QA[page * PER_PAGE:(page + 1) * PER_PAGE]
    for i, (q, a) in enumerate(block):
        col = i % 2
        row = i // 2
        qx = 0.85 + col * 5.9
        qy = 2.3 + row * 1.13
        panel(s, qx, qy, 5.7, 1.03, fill=INK_2, line_col=LINE)
        txt(s, qx + 0.2, qy + 0.1, 5.3, 0.28, q, size=10.5, color=CYAN, bold=True)
        txt(s, qx + 0.2, qy + 0.36, 5.3, 0.62, a, size=8.5, color=GREY, line=1.28)
    page_no(s)
    notes(s, """MEANING
Rapid-reference answers for the viva. Each is one to three sentences and tied to RoadAssist specifically.

SAY
Do not read this slide aloud. It is a reference to glance at while answering.

GUIDANCE
Answer in two moves: first the textbook definition in one sentence, then immediately what it means for RoadAssist. If the honest answer is that we did not implement something, say so and follow with the design decision that would make it adoptable. An examiner values a precise 'not implemented, but here is why the design permits it' far above a vague claim.

MOST LIKELY FOLLOW-UPS
"Show me." - Have the live app, the health endpoint and the test suite ready.
"What is the weakest part?" - Elasticity and replication. Both are infrastructure configuration rather than application changes, and the application is already written to accept them.
""")
