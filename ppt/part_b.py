

# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 6 — M1 ROLES & BOUNDARIES
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "WHO USES THE CLOUD?", eyebrow="MODULE 1 · ROLES AND BOUNDARIES",
            size=32, badge=ARCH)
panel(s, 0.85, 2.3, 11.6, 1.28, fill=INK_2, line_col=BLUE, line_w=1.3)
txt(s, 1.1, 2.45, 4.0, 0.3, "CLOUD PROVIDER", size=13, color=BLUE, bold=True,
    font=SANS_SEMI)
txt(s, 1.1, 2.75, 4.4, 0.7, "Owns and operates the physical estate: data centres,\n"
    "hardware, hypervisors, network fabric, storage arrays.", size=10, color=GREY, line=1.3)
for i, l in enumerate(["Physical servers", "Hypervisor", "Storage array", "Network fabric"]):
    chip(s, 5.9 + i * 1.62, 2.82, 1.52, 0.32, l, color=BLUE, size=8.5, fill=INK_3)
txt(s, 5.9, 3.22, 6.4, 0.3, "Boundary of provider responsibility", size=8.5,
    color=GREY_DIM, italic=True)
arrow(s, 6.65, 3.62, 6.65, 3.88, color=CYAN, width=1.5)
panel(s, 0.85, 3.92, 11.6, 1.28, fill=INK_3, line_col=CYAN, line_w=1.5)
txt(s, 1.1, 4.07, 4.4, 0.3, "ROADASSIST PLATFORM  (cloud consumer, then provider)",
    size=13, color=CYAN, bold=True, font=SANS_SEMI)
txt(s, 1.1, 4.37, 4.4, 0.7, "Consumes provider resources; itself provides a\n"
    "service to its own users. A dual role.", size=10, color=GREY, line=1.3)
for i, l in enumerate(["Fastify API", "Booking engine", "AI rules", "Auth + RBAC"]):
    chip(s, 5.9 + i * 1.62, 4.44, 1.52, 0.32, l, color=CYAN, size=8.5, fill=INK_2)
txt(s, 5.9, 4.84, 6.4, 0.3, "Boundary of application responsibility", size=8.5,
    color=GREY_DIM, italic=True)
arrow(s, 6.65, 5.24, 6.65, 5.5, color=GREEN, width=1.5)
panel(s, 0.85, 5.54, 11.6, 1.1, fill=INK_2, line_col=GREEN, line_w=1.3)
txt(s, 1.1, 5.68, 4.4, 0.3, "CLOUD CONSUMERS / END USERS", size=13, color=GREEN,
    bold=True, font=SANS_SEMI)
txt(s, 1.1, 5.98, 4.4, 0.5, "Seven roles exist in the database.", size=10, color=GREY)
for i, l in enumerate(["citizen", "mechanic", "admin", "gov_officer"]):
    chip(s, 5.9 + i * 1.62, 5.8, 1.52, 0.3, l, color=GREEN, size=8.5, fill=INK_3)
for i, l in enumerate(["fleet_admin", "fleet_driver", "support"]):
    chip(s, 5.9 + i * 1.62, 6.16, 1.52, 0.3, l, color=GREEN, size=8.5, fill=INK_3)
module_rail(s, 1); page_no(s, 6)
notes(s, """MEANING
Three layers, two boundaries. The key insight is that RoadAssist sits in the middle and is BOTH a cloud consumer and a cloud provider.

SAY
"Module 1 defines roles and boundaries. At the top, the cloud provider owns the physical estate - data centres, hypervisors, storage. In the middle, RoadAssist consumes those resources but itself provides a service to its users, so it holds a dual role. At the bottom are the end users, and in our database that is seven distinct roles."

CONCEPT DEMONSTRATED
Module 1 - roles and boundaries: cloud provider, cloud consumer, cloud service owner, and where responsibility changes hands.

RELATION TO ROADASSIST
The seven roles are real and enforced: citizen, mechanic, admin, gov_officer, fleet_admin, fleet_driver, support. Authorization is checked at the resource, not just the route.

IF ASKED
"What is the difference between a cloud consumer and a cloud service owner?" - RoadAssist is a consumer with respect to the infrastructure provider, and a service owner with respect to its own users. The same organisation can hold both roles, and this diagram shows exactly where the line falls.

TRANSITION
"Given those roles - which service and deployment model does RoadAssist correspond to?"
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 7 — M1 DELIVERY & DEPLOYMENT MODELS
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "WHERE DOES ROADASSIST FIT?",
            eyebrow="MODULE 1 · DELIVERY AND DEPLOYMENT MODELS", size=31, badge=ARCH)
txt(s, 0.85, 2.22, 11.6, 0.3,
    "Architectural mapping. The project runs on local containers in development; no commercial cloud provider is used.",
    size=10.5, color=AMBER, italic=True)
hdr = ["MODEL", "WHO MANAGES WHAT", "ROADASSIST MAPPING", "STATUS"]
xs = [0.85, 3.0, 6.4, 10.6]
ws = [2.05, 3.3, 4.1, 1.85]
for i, hcol in enumerate(hdr):
    txt(s, xs[i], 2.6, ws[i], 0.28, hcol, size=9.5, color=GREY_DIM, bold=True, spacing=1.6)
rows = [("IaaS", "Provider gives virtual machines,\nstorage and network; you manage the OS up",
         "Where the containers and database would\nrun in a deployed environment", "MAPPING", CYAN),
        ("PaaS", "Provider also manages runtime and\nscaling; you deploy code only",
         "Fastify API could be deployed as a\nmanaged Node service", "MAPPING", CYAN),
        ("SaaS", "Consumer uses finished software\nover the network",
         "What the customer, mechanic and\nauthority actually experience", "IMPLEMENTED", GREEN)]
y = 2.95
for m, who, mapping, stat, col in rows:
    panel(s, 0.85, y, 11.6, 0.82, fill=INK_2, line_col=LINE)
    txt(s, 1.05, y + 0.24, 1.8, 0.35, m, size=17, color=col, bold=True, font=SANS_SEMI)
    txt(s, 3.0, y + 0.16, 3.3, 0.6, who, size=9.5, color=GREY, line=1.3)
    txt(s, 6.4, y + 0.16, 4.1, 0.6, mapping, size=9.5, color=WHITE, line=1.3)
    chip(s, 10.6, y + 0.26, 1.65, 0.3, stat, color=col, size=8, fill=INK_3)
    y += 0.92
txt(s, 0.85, 5.78, 5.4, 0.3, "DEPLOYMENT MODELS", size=10, color=BLUE, bold=True, spacing=1.8)
dep = [("PUBLIC", "Shared provider estate.\nLowest cost, least control.", CYAN),
       ("PRIVATE", "Dedicated estate. Suits the\ngovernment / RAKSHA tenant.", BLUE),
       ("HYBRID", "Public for the citizen app,\nprivate for authority data.", GREEN)]
dx = 0.85
for t, d, c in dep:
    node(s, dx, 6.08, 3.75, 0.72, t, d, color=c, tsize=11, ssize=8.5)
    dx += 3.93
module_rail(s, 1); page_no(s, 7)
notes(s, """MEANING
The service and deployment model matrix, mapped honestly. Note the STATUS column - only SaaS is marked implemented.

SAY
"Three delivery models. Infrastructure as a Service gives you virtual machines and you manage upward - that is where our containers and database would sit in a deployment. Platform as a Service adds the managed runtime. Software as a Service is finished software over the network, and that is precisely what our customer, mechanic and authority users experience today. So RoadAssist IS a SaaS application; the IaaS and PaaS rows are architectural mapping, not claims."

CONCEPT DEMONSTRATED
Module 1 - cloud delivery models and cloud deployment models.

RELATION TO ROADASSIST
Deployment is deliberately labelled a mapping. The project runs on Docker Compose locally, and is currently exposed over an HTTPS tunnel for demonstration. No commercial cloud provider is used, so no claim is made about one.

IF ASKED
"Which deployment model would you choose?" - Hybrid. The citizen-facing app suits public cloud for reach and cost, while RAKSHA authority data and the medical break-glass records are exactly the kind of data that belongs in a private, jurisdiction-bounded estate. Note that India's data-residency expectations push in the same direction.

TRANSITION
"Every model brings benefits and matching risks."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 8 — M1 BENEFITS VS RISKS
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "CLOUD BENEFITS VS CLOUD CHALLENGES",
            eyebrow="MODULE 1 · GOALS, RISKS AND CHALLENGES", size=31, badge=ARCH)
panel(s, 0.85, 2.35, 5.6, 4.1, fill=INK_2, line_col=GREEN, line_w=1.2)
txt(s, 1.1, 2.55, 5.0, 0.32, "BENEFITS", size=13, color=GREEN, bold=True, spacing=2.2)
ben = [("Scalability", "One platform serves a city or a state without redesign."),
       ("Availability", "A breakdown at 2am must reach a live service."),
       ("Centralised services", "One authoritative booking state, not many copies."),
       ("Remote access", "Any phone browser, no install, no app store."),
       ("Resource sharing", "Customers, mechanics and authorities share one estate."),
       ("Operational flexibility", "Providers are swappable behind adapters.")]
y = 3.0
for t, d in ben:
    txt(s, 1.1, y, 5.1, 0.26, t, size=11.5, color=WHITE, bold=True)
    txt(s, 1.1, y + 0.23, 5.1, 0.3, d, size=9, color=GREY, line=1.2)
    y += 0.55
panel(s, 6.85, 2.35, 5.6, 4.1, fill=INK_2, line_col=RED, line_w=1.2)
txt(s, 7.1, 2.55, 5.0, 0.32, "RISKS AND CHALLENGES", size=13, color=RED, bold=True, spacing=2.2)
risk = [("Security", "Handled: OTP, rotating refresh tokens, resource-scoped RBAC."),
        ("Privacy", "Medical data is break-glass only, and every read is logged."),
        ("Network dependency", "Answered: offline-first PWA with an idempotent sync journal."),
        ("Availability dependency", "An emergency path cannot fail silently - SOS never queues."),
        ("Resource management", "Rate limits per number and per IP guard shared capacity."),
        ("Data protection", "Hash-chained audit log makes tampering detectable.")]
y = 3.0
for t, d in risk:
    txt(s, 7.1, y, 5.1, 0.26, t, size=11.5, color=WHITE, bold=True)
    txt(s, 7.1, y + 0.23, 5.1, 0.3, d, size=9, color=GREY, line=1.2)
    y += 0.55
module_rail(s, 1); page_no(s, 8)
notes(s, """MEANING
Benefits on the left, risks on the right - and critically, each risk names how RoadAssist actually answers it.

SAY
"Cloud brings scalability, availability and centralisation, but it also brings real risks. What I want to show is that we did not just list them - each one has a concrete answer in the build. Network dependency is answered by an offline-first PWA with an idempotent sync journal. Data protection is answered by a hash-chained audit log where tampering is detectable. Privacy is answered by break-glass medical access that is logged and notified."

CONCEPT DEMONSTRATED
Module 1 - goals and benefits, risks and challenges.

RELATION TO ROADASSIST
All six risk answers are implemented and tested. The audit chain has a test that forges an entry and confirms the chain detects the broken link.

IF ASKED
"What happens if the network is down during an emergency?" - This is the most important design decision in the project. Ordinary actions like adding a vehicle are queued and replayed idempotently. But SOS and payments are never queued - they fail loudly and tell the user to call 112 directly, because an emergency that silently waits for signal is worse than one that admits it failed.

TRANSITION
"That covers Module 1. Module 2 asks what technologies make the cloud possible."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 9 — M2 INTRO
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "MODULE 2 — CLOUD ENABLING TECHNOLOGY",
            eyebrow="THE FIVE TECHNOLOGIES BENEATH EVERY CLOUD", size=30, badge=ARCH)
tech = [("DATA CENTER", "Physical estate:\ncompute, storage,\npower, cooling", BLUE, IMPL[0] == "" ),
        ("VIRTUALIZATION", "One physical host,\nmany isolated\nruntimes", CYAN, False),
        ("WEB TECHNOLOGY", "HTTP, REST, the\nbrowser as the\nuniversal client", GREEN, True),
        ("MULTITENANCY", "One instance,\nmany isolated\ntenants", CYAN, False),
        ("SERVICE TECH", "Capabilities exposed\nas independent\nservices", GREEN, True)]
x = 0.85
for t, d, c, _ in tech:
    node(s, x, 2.55, 2.2, 1.65, t, d, color=c, tsize=11.5, ssize=9)
    arrow(s, x + 1.1, 4.24, x + 1.1, 4.62, color=c, width=1.2)
    x += 2.32
panel(s, 0.85, 4.65, 11.6, 0.95, fill=INK_3, line_col=BLUE, line_w=1.5)
txt(s, 1.0, 4.83, 11.3, 0.35, "ROADASSIST BHARAT", size=15, color=WHITE, bold=True,
    align=PP_ALIGN.CENTER, font=SANS_SEMI)
txt(s, 1.0, 5.18, 11.3, 0.3,
    "Customer PWA · Mechanic console · RAKSHA authority dashboard · Public site",
    size=10.5, color=CYAN, align=PP_ALIGN.CENTER)
for i, (lab, col) in enumerate([("Web technology — IMPLEMENTED", GREEN),
                                ("Service technology — IMPLEMENTED", GREEN),
                                ("Multitenancy — SCHEMA PRESENT", AMBER),
                                ("Virtualization — CONTAINERS ONLY", AMBER),
                                ("Data center — PROVIDER LAYER", CYAN)]):
    chip(s, 0.85 + i * 2.32, 5.78, 2.2, 0.32, lab, color=col, size=7.5, fill=INK_2)
txt(s, 0.85, 6.25, 11.6, 0.4,
    "Honest position: the top two are built into the application; multitenancy exists in the schema; "
    "virtualization is container-level, not a hypervisor we operate; the data centre belongs to whichever provider hosts it.",
    size=10, color=GREY_DIM, line=1.35)
module_rail(s, 2); page_no(s, 9)
notes(s, """MEANING
The five Module 2 technologies, with an honest status chip under each. This slide sets up the next three.

SAY
"Module 2 covers the five technologies that make cloud computing possible: data centres, virtualization, web technology, multitenancy, and service technology. I want to be precise about which of these we actually operate. Web technology and service technology are built into the application. Multitenancy exists in the database schema. Virtualization for us is containers, not a hypervisor we run. And the data centre belongs to whichever provider hosts the system."

CONCEPT DEMONSTRATED
Module 2 - the full set of cloud enabling technologies.

RELATION TO ROADASSIST
Docker Compose provides three local services: PostGIS, Redis and Redpanda. Redis and Redpanda are provisioned but not yet used by application code - I state that rather than imply a message-driven architecture that does not exist.

IF ASKED
"You said Redpanda is unused - why is it there?" - It was provisioned as the event-bus stand-in for a future move to event-driven dispatch. It is honest to say it is scaffolding for planned work rather than pretend the system is already event-driven.

TRANSITION
"Starting with the physical foundation."
""")
