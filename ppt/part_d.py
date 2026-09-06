

# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 14 — M3 NETWORK PERIMETER
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "PROTECTING THE CLOUD BOUNDARY",
            eyebrow="MODULE 3 · NETWORK PERIMETER", size=31, badge=PART)
layers = [("INTERNET", "Untrusted. Any client, any network.", RED, 2.35),
          ("NETWORK PERIMETER", "TLS termination · trusted-proxy rules · rate limiting", AMBER, 3.15),
          ("API GATEWAY", "Schema validation on every request (Zod)", CYAN, 3.95),
          ("APPLICATION SERVICES", "Authentication · role gate · resource-level ownership", BLUE, 4.75),
          ("DATABASE", "Parameterised queries · append-only audit chain", GREEN, 5.55)]
for t, d, c, y in layers:
    panel(s, 2.6, y, 8.1, 0.66, fill=INK_2, line_col=c, line_w=1.3)
    txt(s, 2.85, y + 0.08, 3.4, 0.3, t, size=12, color=c, bold=True, font=SANS_SEMI)
    txt(s, 2.85, y + 0.33, 7.6, 0.28, d, size=9.5, color=GREY)
    if y < 5.5:
        arrow(s, 6.65, y + 0.68, 6.65, y + 0.78, color=GREY_DIM, width=1.2)
panel(s, 0.85, 2.35, 1.55, 3.86, fill=INK, line_col=LINE)
txt(s, 0.95, 3.6, 1.35, 1.2, "DEFENCE\nIN\nDEPTH", size=11, color=CYAN, bold=True,
    align=PP_ALIGN.CENTER, line=1.5, spacing=1.4)
panel(s, 10.9, 2.35, 1.55, 3.86, fill=INK, line_col=LINE)
for i, l in enumerate(["OTP", "JWT", "RBAC", "OWNER", "AUDIT"]):
    chip(s, 11.0, 2.75 + i * 0.72, 1.35, 0.42, l, color=GREEN, size=9, fill=INK_3)
txt(s, 0.85, 6.35, 11.6, 0.4,
    "Verified: a forged X-Forwarded-For header from an untrusted peer is ignored, so the per-IP rate limit "
    "cannot be bypassed. No specific firewall product or cloud provider service is claimed.",
    size=10, color=AMBER, line=1.35)
module_rail(s, 3); page_no(s, 14)
notes(s, """MEANING
Defence in depth as five concentric layers, each with a real control.

SAY
"The network perimeter is the controlled boundary between the untrusted internet and internal services. Ours is layered. TLS terminates at the edge. Rate limits apply per phone number and per IP. Every request body is schema-validated with Zod. Then authentication, then a role gate, then - crucially - an ownership check at the resource itself, not just at the route. Finally the database, with an append-only audit chain."

CONCEPT DEMONSTRATED
Module 3 - network perimeter; controlled access and secure communication.

RELATION TO ROADASSIST
This is tested. We ran an attack where a client forges the X-Forwarded-For header to mint itself a fresh rate-limit bucket. With trust configured to loopback only, the forged header is ignored and all requests land in one bucket.

IF ASKED
"Why check ownership at the resource and not the route?" - Because a route-level check only asks 'may this role do this kind of thing'. A resource check asks 'may this specific user touch this specific booking'. Without the second, any authenticated mechanic could drive any customer's job.

IF ASKED
"Do you use a firewall or WAF?" - Not one we operate. That belongs to the hosting provider, so I do not claim it.

TRANSITION
"Behind the perimeter sits virtual compute."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 15 — M3 VIRTUAL SERVER
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "VIRTUAL COMPUTE FOR ROADASSIST SERVICES",
            eyebrow="MODULE 3 · VIRTUAL SERVER", size=30, badge=ARCH)
node(s, 4.4, 5.72, 4.5, 0.62, "PHYSICAL INFRASTRUCTURE", "provider-owned estate",
     color=GREY_DIM, tsize=11, ssize=8.5)
arrow(s, 6.65, 5.7, 6.65, 5.5, color=CYAN, width=1.3)
node(s, 4.4, 4.82, 4.5, 0.62, "VIRTUAL SERVER", "isolated, allocatable compute unit",
     color=CYAN, tsize=12, ssize=8.5)
arrow(s, 6.65, 4.8, 6.65, 4.6, color=BLUE, width=1.3)
node(s, 4.4, 3.92, 4.5, 0.62, "API RUNTIME", "Fastify · Node · stateless per request",
     color=BLUE, tsize=12, ssize=8.5)
mods = [("AUTH", 0.85, GREEN), ("BOOKING", 2.85, GREEN), ("AI", 4.85, CYAN),
        ("MAP", 6.55, CYAN), ("RAKSHA", 8.25, RED), ("SYNC", 10.45, BLUE)]
for t, mx, c in mods:
    node(s, mx, 2.72, 1.85, 0.6, t, color=c, tsize=11)
    arrow(s, mx + 0.92, 3.34, 6.65, 3.9, color=c, width=1.0)
panel(s, 0.85, 6.5, 11.6, 0.32, fill=INK_2, line_col=AMBER, line_w=1.0)
txt(s, 1.05, 6.55, 11.2, 0.25,
    "Architectural concept. Today the API runs as a single Node process; the isolation boundary shown is the deployment target, not current infrastructure.",
    size=9, color=AMBER)
module_rail(s, 3); page_no(s, 15)
notes(s, """MEANING
How virtualized compute would carry the platform's workloads, read bottom-up, with the honesty band at the base.

SAY
"A virtual server is an isolated, allocatable unit of compute carved out of physical infrastructure. Our API runtime would sit on one. Critically, request handling is stateless - the session lives in a signed token, not in server memory - which is precisely what allows more virtual servers to be added without redesigning anything."

CONCEPT DEMONSTRATED
Module 3 - virtual server; workload isolation and allocation.

RELATION TO ROADASSIST
The statelessness is real and is the enabling property. Today it runs as one Node process, which I label clearly.

IF ASKED
"What is a virtual server?" - A software-defined server that behaves like a physical one but shares underlying hardware with others, allocated on demand and isolated from its neighbours.

IF ASKED
"Why does statelessness matter?" - Because if a user's session lived in one server's memory, their next request would have to reach that same server. Since ours lives in a JWT the client presents, any instance can serve any request - which is the precondition for load balancing and horizontal scaling.

TRANSITION
"Compute is only half of it. Data has to persist and survive."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 16 — M3 STORAGE & REPLICATION
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "DATA MUST BE AVAILABLE WHEN USERS NEED IT.",
            eyebrow="MODULE 3 · CLOUD STORAGE DEVICE AND RESOURCE REPLICATION",
            size=29, badge=PART)
panel(s, 0.85, 2.35, 5.3, 4.05, fill=INK_2, line_col=CYAN, line_w=1.2)
txt(s, 1.1, 2.53, 4.8, 0.3, "CLOUD STORAGE — WHAT WE HOLD", size=11, color=CYAN,
    bold=True, spacing=1.5)
chip(s, 1.1, 2.86, 1.5, 0.28, "IMPLEMENTED", color=GREEN, size=7.5, fill=INK_3)
store = [("Identity & sessions", "users, roles, sessions, otp_challenges"),
         ("Vehicle data", "vehicles, user_vehicles, documents"),
         ("Booking records", "bookings, booking_events, offers"),
         ("Service & money", "invoices, payments, reviews"),
         ("Emergency", "incidents, responses, emergency_contacts"),
         ("RAKSHA operations", "edge_devices, detections, road_segments"),
         ("Audit", "hash-chained, append-only, tamper-evident")]
y = 3.3
for t, d in store:
    txt(s, 1.1, y, 4.8, 0.26, t, size=10.5, color=WHITE, bold=True)
    txt(s, 1.1, y + 0.21, 4.8, 0.26, d, size=8.5, color=GREY, font=MONO)
    y += 0.44
panel(s, 6.5, 2.35, 5.95, 4.05, fill=INK_2, line_col=AMBER, line_w=1.2)
txt(s, 6.75, 2.53, 5.4, 0.3, "RESOURCE REPLICATION", size=11, color=AMBER,
    bold=True, spacing=1.5)
chip(s, 6.75, 2.86, 2.4, 0.28, "ARCHITECTURAL CONCEPT", color=AMBER, size=7.5, fill=INK_3)
node(s, 8.4, 3.34, 2.2, 0.6, "PRIMARY", "authoritative writes", color=GREEN, tsize=11, ssize=8)
arrow(s, 9.5, 3.96, 9.5, 4.28, color=AMBER, width=1.3, dashed=True)
txt(s, 9.62, 4.0, 2.6, 0.24, "replication stream", size=8, color=AMBER, italic=True)
node(s, 6.75, 4.32, 2.5, 0.6, "REPLICA A", "read scale-out", color=CYAN, tsize=10.5, ssize=8)
node(s, 9.7, 4.32, 2.5, 0.6, "REPLICA B", "failover standby", color=CYAN, tsize=10.5, ssize=8)
arrow(s, 9.5, 3.96, 8.0, 4.3, color=AMBER, width=1.1, dashed=True)
node(s, 8.4, 5.32, 2.2, 0.6, "BACKUP", "point-in-time restore", color=BLUE, tsize=10.5, ssize=8)
arrow(s, 9.5, 4.94, 9.5, 5.3, color=BLUE, width=1.1, dashed=True)
txt(s, 6.75, 6.02, 5.4, 0.3,
    "Today: a single PostgreSQL instance. No replica is configured — stated, not implied.",
    size=9, color=AMBER, line=1.25)
module_rail(s, 3); page_no(s, 16)
notes(s, """MEANING
What we genuinely store on the left; how replication would work on the right, clearly marked as concept.

SAY
"On the left is real: 61 tables covering identity, vehicles, bookings, money, emergencies, RAKSHA operations, and a hash-chained audit log. On the right is the replication architecture - a primary taking authoritative writes, replicas for read scale-out and failover, and backups for point-in-time restore. I want to be explicit: today we run a single PostgreSQL instance. No replica is configured. The dashed lines mean designed-for, not built."

CONCEPT DEMONSTRATED
Module 3 - cloud storage device and resource replication.

RELATION TO ROADASSIST
Storage is PostgreSQL 16 with PostGIS 3.4.3. The audit table is genuinely append-only with database rules preventing update and delete, and the chain is verified on read.

IF ASKED
"What is resource replication?" - Creating multiple instances of the same resource - usually storage or a server - so that load can be spread and a failure of one does not lose the service.

IF ASKED
"Why have you not implemented replication?" - It is an infrastructure configuration rather than an application change, and it needs a hosted database to be meaningful. The application is already written so that it would not need modifying - reads and writes both go through one data layer.

TRANSITION
"To decide when replication or scaling is needed, you must first measure."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 17 — M3 CLOUD USAGE MONITOR
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "OBSERVE. MEASURE. OPTIMIZE.",
            eyebrow="MODULE 3 · CLOUD USAGE MONITOR", size=32, badge=PART)
txt(s, 0.85, 2.22, 11.6, 0.3,
    "Cloud usage monitoring architecture. Metric values below are illustrative of the mechanism — no measurements are claimed.",
    size=10, color=AMBER, italic=True)
metrics = [("CPU", "compute pressure", BLUE), ("MEMORY", "working set", BLUE),
           ("STORAGE", "growth rate", CYAN), ("NETWORK", "throughput", CYAN),
           ("REQUESTS", "per endpoint", GREEN), ("ACTIVE USERS", "concurrency", GREEN),
           ("SERVICE LOAD", "queue depth", AMBER), ("ERROR RATE", "failed calls", RED)]
for i, (t, d, c) in enumerate(metrics):
    mx = 0.85 + (i % 4) * 2.95
    my = 2.62 + (i // 4) * 1.12
    panel(s, mx, my, 2.8, 0.95, fill=INK_2, line_col=c, line_w=1.1)
    txt(s, mx + 0.18, my + 0.12, 2.4, 0.26, t, size=10, color=c, bold=True, spacing=1.4)
    txt(s, mx + 0.18, my + 0.38, 2.4, 0.24, d, size=8.5, color=GREY_DIM)
    # a small sparkline-like bar row
    for b in range(9):
        hgt = 0.06 + 0.20 * abs(math.sin(i * 1.3 + b * 0.7))
        bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(mx + 0.18 + b * 0.27),
                                 Inches(my + 0.84 - hgt), Inches(0.16), Inches(hgt))
        bar.fill.solid(); bar.fill.fore_color.rgb = c
        bar.line.fill.background(); bar.shadow.inherit = False
panel(s, 0.85, 5.05, 11.6, 0.75, fill=INK_3, line_col=CYAN, line_w=1.3)
txt(s, 1.05, 5.18, 5.4, 0.3, "WHAT ROADASSIST ACTUALLY MEASURES TODAY", size=10.5,
    color=CYAN, bold=True, spacing=1.4)
txt(s, 1.05, 5.44, 11.0, 0.3,
    "GET /health returns database latency and live provider status · every request is logged with a unique id and response time · "
    "model_predictions records AI latency and fallback use",
    size=9.5, color=WHITE)
for i, (t, c) in enumerate([("RESOURCE PLANNING", BLUE), ("PERFORMANCE", CYAN),
                            ("SCALABILITY DECISIONS", GREEN), ("AVAILABILITY", AMBER)]):
    node(s, 0.85 + i * 2.95, 6.0, 2.8, 0.55, t, color=c, tsize=10)
module_rail(s, 3); page_no(s, 17)
notes(s, """MEANING
The monitoring mechanism as architecture, plus a clearly separated band of what we genuinely measure.

SAY
"A cloud usage monitor collects runtime data - CPU, memory, storage, network, request counts, concurrency, service load, errors. That data is what makes resource planning, performance work, scaling decisions and availability guarantees possible. The bars here illustrate the mechanism; they are not our measurements. What we do genuinely have is in the band below: a health endpoint reporting live database latency and provider status, per-request logging with response times, and a model_predictions table recording AI latency and whether the fallback was used."

CONCEPT DEMONSTRATED
Module 3 - cloud usage monitor; measured service, which is also the fifth essential characteristic from Module 1.

RELATION TO ROADASSIST
The health endpoint is real and I can call it live. The per-request logging is Fastify's, with a generated request id on every call.

IF ASKED
"Are those real numbers?" - No, and I have labelled them illustrative. Inventing measurements would be dishonest. What I can show live is the health endpoint returning genuine database latency.

IF ASKED
"What is cloud usage monitoring for?" - Two things: billing, because measured service is how consumption is charged; and control, because you cannot scale or plan capacity against data you do not have.

TRANSITION
"With measurement in place, Module 4 asks what architectures you can then build."
""")
