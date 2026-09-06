

# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 10 — M2 DATA CENTER
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "THE CLOUD NEEDS A PHYSICAL FOUNDATION.",
            eyebrow="MODULE 2 · DATA CENTER TECHNOLOGY", size=31, badge=ARCH)
visual(s, 0.85, 2.35, 5.5, 3.3, str(ASSETS / "vis_datacenter.png"), "dc")
panel(s, 6.7, 2.35, 5.75, 3.3, fill=INK_2, line_col=LINE)
txt(s, 6.95, 2.55, 5.3, 0.3, "WHAT A DATA CENTRE PROVIDES", size=10.5, color=BLUE,
    bold=True, spacing=1.8)
items = [("Compute", "Racked servers running virtualized workloads", BLUE),
         ("Storage", "Disk arrays and storage networks", CYAN),
         ("Networking", "Switching fabric, routing, external links", CYAN),
         ("Power", "Redundant supply and battery / generator backup", GREEN),
         ("Cooling", "Thermal management that bounds density", GREEN),
         ("Monitoring", "Environmental and hardware telemetry", AMBER)]
y = 2.98
for t, d, c in items:
    chip(s, 6.95, y + 0.03, 0.2, 0.2, "", color=c, fill=c)
    txt(s, 7.28, y - 0.02, 5.0, 0.28, t, size=11.5, color=WHITE, bold=True)
    txt(s, 7.28, y + 0.22, 5.0, 0.28, d, size=9, color=GREY)
    y += 0.44
for i, (t, c) in enumerate([("DATA CENTRE", BLUE), ("CLOUD RESOURCES", CYAN),
                            ("ROADASSIST SERVICES", GREEN)]):
    node(s, 0.85 + i * 4.15, 5.85, 3.5, 0.62, t, color=c, tsize=12)
    if i < 2:
        arrow(s, 0.85 + i * 4.15 + 3.52, 6.16, 0.85 + (i + 1) * 4.15 - 0.02, 6.16, color=CYAN)
module_rail(s, 2); page_no(s, 10)
notes(s, """MEANING
Physical infrastructure is the base of every cloud claim. This slide keeps the abstraction honest.

SAY
"Everything we call 'the cloud' ultimately runs on physical machines in a building with power and cooling. A data centre supplies compute, storage, networking, power, cooling and monitoring. Those become cloud resources, and cloud resources are what RoadAssist services consume."

CONCEPT DEMONSTRATED
Module 2 - data center technology: the physical substrate and why density, power and cooling bound what the cloud can offer.

RELATION TO ROADASSIST
This layer is the provider's, not ours. In development the equivalent is a single machine running Docker containers. That is stated rather than dressed up.

IF ASKED
"Why does cooling matter to a software project?" - Because it bounds server density and therefore cost per unit of compute, which is ultimately what makes on-demand elastic pricing possible for a consumer like us.

TRANSITION
"The technology that turns one physical machine into many usable ones is virtualization."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 11 — M2 VIRTUALIZATION
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "ONE PHYSICAL SYSTEM. MULTIPLE VIRTUAL RESOURCES.",
            eyebrow="MODULE 2 · VIRTUALIZATION TECHNOLOGY", size=29, badge=ARCH)
panel(s, 2.4, 5.62, 8.5, 0.72, fill=INK_2, line_col=BLUE, line_w=1.3)
txt(s, 2.6, 5.78, 8.1, 0.4, "PHYSICAL SERVER   ·   CPU · MEMORY · DISK · NIC",
    size=12.5, color=WHITE, bold=True, align=PP_ALIGN.CENTER, font=SANS_SEMI)
panel(s, 2.4, 4.72, 8.5, 0.72, fill=INK_3, line_col=CYAN, line_w=1.5)
txt(s, 2.6, 4.88, 8.1, 0.4, "HYPERVISOR  /  VIRTUALIZATION LAYER",
    size=12.5, color=CYAN, bold=True, align=PP_ALIGN.CENTER, font=SANS_SEMI)
arrow(s, 6.65, 5.6, 6.65, 5.46, color=CYAN, width=1.4)
vms = [("VIRTUAL SERVER 1", "API · auth · booking", 2.4, BLUE),
       ("VIRTUAL SERVER 2", "AI diagnosis · rules", 5.35, CYAN),
       ("VIRTUAL SERVER 3", "Map proxy · RAKSHA", 8.3, GREEN)]
for t, d, vx, c in vms:
    node(s, vx, 3.55, 2.6, 0.95, t, d, color=c, tsize=11, ssize=9)
    arrow(s, vx + 1.3, 4.7, vx + 1.3, 4.54, color=c, width=1.2)
svcs = ["AUTH", "BOOKING", "AI", "MAP", "RAKSHA", "SYNC"]
for i, sv in enumerate(svcs):
    chip(s, 2.4 + i * 1.44, 2.85, 1.35, 0.42, sv, color=WHITE, size=10, fill=INK_2)
    arrow(s, 3.07 + i * 1.44, 3.29, 3.07 + i * 1.44, 3.52, color=GREY_DIM, width=1.0)
panel(s, 0.85, 2.35, 11.6, 0.42, fill=INK_2, line_col=AMBER, line_w=1.1)
txt(s, 1.05, 2.44, 11.2, 0.3,
    "Honest scope: RoadAssist uses OS-level virtualization (Docker containers) in development. "
    "We do not operate a hypervisor — that layer belongs to the infrastructure provider.",
    size=10, color=AMBER)
module_rail(s, 2); page_no(s, 11)
notes(s, """MEANING
The classic virtualization stack, read bottom-up, with an explicit honesty band at the top.

SAY
"Read this from the bottom. One physical server. Above it a hypervisor, which is the layer that lets a single machine present itself as several isolated ones. Above that, virtual servers, each carrying a share of the workload. And above those, the actual RoadAssist services. I want to be precise: we use OS-level virtualization - Docker containers - not a hypervisor we operate ourselves. That distinction matters."

CONCEPT DEMONSTRATED
Module 2 - virtualization technology; hardware independence, server consolidation, isolation.

RELATION TO ROADASSIST
Docker Compose runs PostGIS, Redis and Redpanda as isolated containers. The API itself runs as a Node process. In a deployed environment these become virtual servers on provider infrastructure.

IF ASKED
"Difference between a virtual machine and a container?" - A virtual machine virtualizes hardware and runs its own kernel; a container virtualizes the operating system and shares the host kernel. Containers are lighter and start faster, VMs give stronger isolation. We use containers.

IF ASKED
"Why is virtualization useful?" - Consolidation, isolation and portability. Several workloads share one machine safely, and a workload can be moved between machines because it no longer depends on specific hardware.

TRANSITION
"Above virtualization sit the technologies the user actually touches."
""")


# ═════════════════════════════════════════════════════════════════════════════
#  SLIDE 12 — M2 WEB / MULTITENANT / SERVICE
# ═════════════════════════════════════════════════════════════════════════════
s = new_slide(BG_MOD)
title_block(s, "FROM CLOUD INFRASTRUCTURE TO USER SERVICES",
            eyebrow="MODULE 2 · WEB · MULTITENANT · SERVICE TECHNOLOGY",
            size=29, badge=PART)
# Web
panel(s, 0.85, 2.35, 3.65, 4.05, fill=INK_2, line_col=GREEN, line_w=1.2)
txt(s, 1.05, 2.52, 3.3, 0.3, "WEB TECHNOLOGY", size=11.5, color=GREEN, bold=True, spacing=1.4)
chip(s, 1.05, 2.85, 1.5, 0.28, "IMPLEMENTED", color=GREEN, size=7.5, fill=INK_3)
for i, (t, d) in enumerate([("HTTP / REST", "58 JSON routes, uniform error envelope"),
                            ("Browser client", "No install; the URL is the app"),
                            ("PWA", "Manifest + service worker, installable"),
                            ("Offline shell", "19 assets cached for a dead network")]):
    txt(s, 1.05, 3.3 + i * 0.75, 3.3, 0.28, t, size=11, color=WHITE, bold=True)
    txt(s, 1.05, 3.53 + i * 0.75, 3.3, 0.45, d, size=9, color=GREY, line=1.25)
# Multitenant
panel(s, 4.85, 2.35, 3.6, 4.05, fill=INK_2, line_col=AMBER, line_w=1.2)
txt(s, 5.05, 2.52, 3.3, 0.3, "MULTITENANT TECHNOLOGY", size=11.5, color=AMBER,
    bold=True, spacing=1.4)
chip(s, 5.05, 2.85, 1.75, 0.28, "SCHEMA PRESENT", color=AMBER, size=7.5, fill=INK_3)
for i, (t, d) in enumerate([("One instance", "A single deployment serves every tenant"),
                            ("Fleet tenancy", "fleets + fleet_members tables exist"),
                            ("Gov tenancy", "gov_jurisdictions + gov_officers"),
                            ("Isolation by role", "Queries scoped to the caller, not the route")]):
    txt(s, 5.05, 3.3 + i * 0.75, 3.2, 0.28, t, size=11, color=WHITE, bold=True)
    txt(s, 5.05, 3.53 + i * 0.75, 3.2, 0.45, d, size=9, color=GREY, line=1.25)
# Service
panel(s, 8.8, 2.35, 3.65, 4.05, fill=INK_2, line_col=CYAN, line_w=1.2)
txt(s, 9.0, 2.52, 3.3, 0.3, "SERVICE TECHNOLOGY", size=11.5, color=CYAN, bold=True, spacing=1.4)
chip(s, 9.0, 2.85, 1.5, 0.28, "IMPLEMENTED", color=GREEN, size=7.5, fill=INK_3)
svc = ["AUTH / OTP", "BOOKING", "AI DIAGNOSIS", "MAP", "RAKSHA / SOS",
       "PAYMENT", "OFFLINE SYNC", "AUDIT"]
for i, sv in enumerate(svc):
    chip(s, 9.0 + (i % 2) * 1.68, 3.28 + (i // 2) * 0.55, 1.58, 0.42, sv,
         color=CYAN, size=8.5, fill=INK_3)
txt(s, 9.0, 5.72, 3.3, 0.55,
    "Each capability is an independently addressable service behind one API contract.",
    size=9, color=GREY, line=1.25)
module_rail(s, 2); page_no(s, 12)
notes(s, """MEANING
The three user-facing Module 2 technologies side by side, each with its true status.

SAY
"Web technology is fully implemented - 58 REST routes, and a Progressive Web App that installs to the home screen and keeps a 19-asset shell cached for offline use. Service technology is fully implemented - eight independent capabilities behind one API contract. Multitenancy I mark honestly as schema-present: the fleet and government tenancy tables exist and role-scoped queries are enforced, but we have not yet run genuinely separate tenants in production."

CONCEPT DEMONSTRATED
Module 2 - web technology, multitenant technology, service technology.

RELATION TO ROADASSIST
All verified: the manifest declares four shortcuts and five icons; the service worker caches 19 shell assets; fleets, fleet_members, gov_jurisdictions and gov_officers all exist as tables.

IF ASKED
"What is multitenancy?" - One running instance of the software serving multiple independent customer organisations, with their data isolated from one another. Our tenants would be vehicle fleets and government jurisdictions, and isolation is enforced by scoping every query to the caller's identity rather than trusting the route.

TRANSITION
"Module 3 goes one level deeper - the specific infrastructure mechanisms."
""")
