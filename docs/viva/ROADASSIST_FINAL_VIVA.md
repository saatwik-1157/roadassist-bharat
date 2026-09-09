> Generated 2026-09-06. Every answer is grounded in the actual repository. The
> longer 56-question set lives in `app/docs/VIVA.md`; this is the 35 asked for
> in Phase 13, answered short enough to say out loud.

# Final viva defence — 35 questions

**1. Why cloud computing?**
Three reasons that are real here: we are a SaaS provider to three user classes
and a SaaS consumer through adapters; dispatch is dynamic scheduling over a
pooled resource; and the failure we designed for — the *user's* connectivity
dying — is a cloud risk, not a coding bug.

**2. Why not a normal web application?**
A normal web app assumes the network. Ours classifies it, and keeps a working
emergency path when it is gone. That is an architectural difference, not a
feature.

**3. Which cloud characteristics are demonstrated?**
Broad network access, genuinely: one API serves a browser, a PWA, an Android
WebView and a feature phone over SMS. Resource pooling, genuinely: 600
mechanics allocated by dispatch. On-demand self-service and measured usage we
consume in design only.

**4. Which service model?**
All three, in different roles. SaaS we *provide*. IaaS we stand in for locally
with compose. PaaS we consume in design — nothing is deployed.

**5. Which deployment model?**
Public cloud with an Indian data-residency constraint — no PII leaves India.
Reasoned in the team charter and ADR-0001. Not deployed.

**6. Where is virtualization?**
OS-level: a four-stage Dockerfile, non-root uid 1000, tini as PID 1, a real
HEALTHCHECK, and five service containers. Hardware virtualization is the layer
beneath, which we consume rather than operate.

**7. What is multitenancy?**
Row-level tenancy on a shared schema — every read scoped by `user_id`, with
`gov_jurisdictions` scoping the authority tenant. Proven, not asserted: twelve
cross-tenant attacks, all refused.

**8. How does dispatch work?**
A PostGIS nearest-neighbour search that excludes off-duty and already-committed
providers in SQL, ranks the rest by proximity 60% / rating 34% plus a newcomer
bonus, and offers in waves of five with a 90-second TTL that escalates.

**9. Why is dispatch dynamic scheduling?**
Work is assigned at run time, from a pool, by a score computed from live state,
with timeout-driven re-scheduling to the next wave when nobody answers. That is
the definition.

**10. How does offline mode work?**
A connectivity manager classifies the network from measured evidence. Off-grid,
the same rule table runs on the device, and an SOS becomes a real incident in
encrypted IndexedDB with its own reference, GPS fix and a queued sync journal
entry.

**11. What happens when internet disappears?**
GPS keeps working — it transmits nothing. Diagnosis keeps working. Cached maps
render. An SOS is created, stored and queued, and the app says plainly that
nothing has been transmitted. Dispatch, tracking, ETAs and payment stop, and it
says which.

**12. Can SOS contact emergency services offline?**
**No.** There is no satellite link, no mesh, no SMS path that bypasses the data
network. The app tells you to call 112, because voice often works on a signal
too weak for data. Even online, the 112 handoff is a stub and our own API
response says so.

**13. How does synchronisation work?**
Store and forward. The journal entry retries with fully jittered exponential
backoff; on success the incident gains a server id and the journal empties.

**14. How are duplicates prevented?**
`client_incident_id` and a per-device `op_id` are unique in the database. A
retry after a lost response — the normal way retries duplicate things —
converges on the row that already exists.

**15. How is payment secured?**
The amount is never taken from the request; it is the invoice total. The
signature is recomputed server-side. A forged signature settles nothing. A
replayed confirmation does not charge twice. `payment.settled` is refused
unless a settled payment covers the invoice.

**16. How is authentication secured?**
OTP with per-number and per-IP ceilings, short-lived access tokens, and refresh
rotation with reuse detected as theft.

**17. How is authorization enforced?**
`bookingAudience()` — the booking's customer, the assigned mechanic, or an
admin. Nobody else. Commands are additionally filtered by role, so a mechanic
cannot cancel and a customer cannot declare arrival.

**18. How is medical data protected?**
Separate table, restricted access, and every read written to an access log.
Break-glass access is recorded rather than prevented, because in an emergency
the wrong answer is to block the responder.

**19. What is your cloud infrastructure?**
Locally: PostGIS, Redis and Redpanda in compose, plus a production image.
In a cloud: **nothing**. No account exists.

**20. Where is resource pooling?**
600 mechanics. `findCandidates` excludes off-duty and busy providers in SQL,
then allocates from what remains.

**21. Where is dynamic scalability?**
One real component: the readiness gate. Stop Postgres and `/health` returns 503
while `/v1/ping` still returns 200, which is what lets an orchestrator remove an
instance. The autoscaler is not provisioned.

**22. Is auto-scaling actually deployed?**
No. Slide 22 says DESIGN and I will not pretend otherwise.

**23. Where is load balancing?**
No infrastructure load balancer. *Workload distribution* — the syllabus's own
framing — is what dispatch does across a provider pool. That part is real.

**24. Where is replication?**
Nowhere. The precondition is built — the API is stateless, session state is in
the JWT — and the three things that would break replication today are the
in-process SSE registry, rate limiter and offer sweeper.

**25. What happens if the database fails?**
`/health` returns 503 naming the database, `/v1/ping` still returns 200, and
recovery is automatic with no restart. I can demonstrate it in twenty seconds.

**26. What happens if the AI fails?**
Timeout, network error or bad payload all return the rules result with
`usedFallback: true` and `modelVersion: "rules-1.0.0"`. A model may make a
verdict stricter, never laxer.

**27. What happens if GPS fails?**
An approximate position is used and the app *says* it is approximate. It is
never fabricated silently.

**28. How do you prevent double assignment?**
`SELECT … FOR UPDATE` on the booking row, with the offer's expiry checked
inside the transaction. Ten simultaneous accepts produce one winner and nine
clean refusals. An earlier version read the status outside the transaction and
two mechanics could both win — that was a real bug, found by our own suite.

**29. How do you prevent double payment?**
Settlement is recorded, never asserted, and the confirmation is idempotent.

**30. What are the major limitations?**
Nothing deployed; single instance; 112 stubbed; payments sandbox-only; no
backup schedule; the roadside engine is rules, not a model.

**31. What would you build next?**
Redis-backed rate limiting, the outbox → event bus for SSE fan-out, and WAL
archiving. Those three are what stand between this and a second instance.

**32. Why is this startup-worthy?**
The hard part is not the marketplace; it is that the product keeps working
where the customer is. That is a durable difference in a market where coverage
is worst exactly where breakdowns are most dangerous.

**33. What is your competitive advantage?**
A competitor would have to build the offline incident path, the device/cloud
rule parity guard, and the idempotent sync — and then earn the willingness to
say "nothing has been transmitted" instead of showing a spinner.

**34. What is your business model?**
Potential, not current: B2C subscription, per-job commission, and B2B fleet or
authority licensing. No commercial operation exists; this is a university
project and the slide says so.

**35. What is your most important innovation?**
That the emergency path degrades honestly. Every other roadside app shows a
spinner when the network dies. Ours creates the incident, stores it encrypted,
tells you exactly what has and has not happened, and forwards it without
duplicating when signal returns.
