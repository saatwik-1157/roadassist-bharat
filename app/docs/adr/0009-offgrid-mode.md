# ADR-0009 — Off-Grid Mode: the platform degrades in public, never in secret

**Status:** Accepted · 2026-09-06 · Owner: P1 (Saatwik) + P2 (Nirisha) + P4 (Parthavi)

## Context

"Offline is a first-class mode, not a fallback" has been a stated non-negotiable
since the charter, and the platform already honoured parts of it: the service
worker cached the app shell, Trip Guardian pre-downloaded map tiles, and a
`sync_operations` journal replayed safe writes idempotently on reconnect.

Three things were still not true, and they were the three that matter most on a
rural highway at night:

1. **Connectivity was a boolean, and a dishonest one.** Every surface formed its
   own opinion from `navigator.onLine`, which reports whether the OS has a
   network *interface*. A phone camped on a cell with no backhaul — the normal
   dead-zone failure in India — reports `true`, so the app cheerfully claimed to
   be online while nothing could reach us.
2. **SOS simply failed.** ADR-0005 forbids queueing an emergency silently, which
   was right: an SOS that waits quietly for signal while the user believes help
   is coming is the worst outcome in the system. But "fail loudly" left the
   person with nothing at all — no record, no reference, nothing to synchronise
   later.
3. **AI diagnosis needed the server.** The rules engine that is the permanent
   fallback for the model (ADR-0006) ran only in the cloud, so the one capability
   that has no technical need for a network was unavailable without one.

## Decision

Off-Grid Mode. Three tiers, an on-device engine, and a store-and-forward journal
built for emergencies specifically.

### 1. Connectivity is measured, and the measurement is pessimistic

One connectivity manager owns the tier for the whole app:

| Tier | Meaning | What the app does |
|---|---|---|
| `ONLINE` | Reachable and answering promptly | Everything |
| `LIMITED` | Reachable but failing or slow | Still attempts requests; what fails is stored, not lost |
| `OFFLINE` | Nothing is getting out | Local emergency mode |

Inputs: `navigator.onLine`, the Network Information API where present, a
DB-free `GET /v1/ping` probe (RTT and success), and the running count of
transport failures the app's own `api()` layer reports. `navigator.onLine` can
only ever make the verdict *worse*, never better.

The asymmetry is the whole point and it matches ADR-0005's: under-claiming
connectivity costs a queued request; over-claiming it costs somebody who thinks
an ambulance was called.

`/health` deliberately still hits the database while `/v1/ping` does not. That
is what keeps "the network is dead" and "the platform is sick" distinguishable
from a phone at the roadside.

### 2. An off-grid SOS is created, stored, and *said* to be stored

Pressing SOS with no connection does not fail and does not queue silently. It:

1. mints a local reference — `RA-K7P2QX`, short enough to read aloud over a
   borrowed phone or a police radio;
2. captures the GPS fix (a satellite receiver needs no internet), the timestamp,
   the vehicle, the emergency type and the last local diagnosis;
3. writes the incident and its journal entry to IndexedDB **in one
   transaction** — either both land or neither does;
4. tells the user, in these words: *"OFF-GRID SOS CREATED. No network connection
   detected. Your emergency information is stored securely on this device and
   will be synchronized automatically when connectivity returns."*

It never claims transmission. It says explicitly that no contact, mechanic or
responder has been alerted, and it recommends calling 112 if a voice line is
reachable — voice frequently works on a signal too weak for data.

### 3. Sync is store-and-forward, authenticated, re-validated and idempotent

```
OFFLINE JOURNAL → AUTHENTICATE → SEND → SERVER VALIDATION →
IDEMPOTENCY CHECK → DATABASE UPDATE → MARK SYNCHRONIZED
```

Every journal entry carries an operation id (which is the idempotency key), the
incident id, a type, a timestamp, the payload, a sync status, a retry count and
an integrity digest. `POST /v1/sos/offline-sync` takes them under the ordinary
session — there is no anonymous intake path for an emergency — and
`incidents.client_incident_id` is UNIQUE, so a retry after a lost response
collides and does nothing instead of raising a second emergency.

Retries use exponential backoff with **full jitter**. A convoy leaving a tunnel
puts every phone back online in the same second; without jitter they would retry
in lockstep, and a sync storm at the moment connectivity returns is precisely
what a platform handling emergencies cannot afford.

**Syncing does not escalate.** The endpoint records the incident; it alerts
nobody. An incident that may be three hours old must not silently SMS a family
at 3am on reconnect, so escalation stays where it already lives — the explicit
`POST /v1/sos/:id/confirm` ladder the client calls as a visible step of the
reconnection flow. Same discipline as ADR-0005: a signal is raised, a human
confirms.

### 4. The device's rules engine mirrors the server's, and CI enforces it

`apps/web/offline-engine.js` holds the same rule table as
`apps/api/src/domain/ai-rules.ts`. `apps/api/test/offline-engine.test.ts`
diagnoses a corpus through **both** and fails the build on any divergence in
cause, confidence, severity, drivability, parts or advice.

Two tables rather than one shared module is a deliberate trade: the client file
must be loadable by a browser as a plain ES module with no build step, and the
server file must keep its TypeScript types and stay inside `apps/api`. A tested
mirror is honest about the duplication; a comment saying "keep these in sync"
would not be.

The local answer is always labelled **LOCAL OFFLINE DIAGNOSIS** with its engine
version. It is never presented as "AI vehicle diagnosis". It also lists the
runners-up, because offline there is no model to ask for a second opinion, and a
list of possibilities is more truthful than one rule hit dressed as a finding.

### 5. Local data is protected as far as the platform honestly can

Payloads are encrypted at rest with AES-GCM-256 under a **non-extractable**
`CryptoKey` generated on the device and held in IndexedDB — the browser will use
it but will not hand its bytes to any script, so a copy of the storage taken off
the device does not yield plaintext.

It is **not** protection against code running on this origin, which can ask the
store to decrypt. The UI says exactly that rather than implying more. Where
WebCrypto is unavailable (a plain-http origin that is not localhost) the store
falls back to plaintext and **says so on screen**.

The store holds no access token, no refresh token, no payment credential and no
server secret. It has never needed one, so it has never kept one.

Retention: a synchronised incident is deleted from the device 24 hours after it
reaches the platform. Anything **not** synchronised is never deleted, at any
age — losing somebody's emergency to a retention timer is not an acceptable
trade for tidiness.

### 6. Connectivity hierarchy

| Tier | Path | Status |
|---|---|---|
| 1 | Internet → cloud services | **Implemented** |
| 2 | Cellular / SMS fallback | **Implemented where the platform can genuinely reach it.** The API has a real inbound SMS journey (`POST /v1/telecom/sms`) that raises an SOS from a feature phone with no app at all, and the **Android** client (`mobile/.../Emergency.kt`) genuinely descends a ladder: data → `SmsManager` SOS with delivery confirmation → hand-off to the 112 dialer → device queue. The **browser** client cannot originate an SMS — the web platform gives a page no such API — so it tells the user to call 112 rather than pretending it sent one. The distinction is stated in the UI of each. |
| 3 | Device off-grid mode | **Implemented** — this ADR |
| 4 | Satellite emergency communication | **Not implemented. Future.** No satellite service is integrated, and none is claimed anywhere in the product. |

## Consequences

- Off-Grid Mode is an enhancement layer, not a rewrite: the modules load
  dynamically and a browser that cannot run them still runs the whole app. The
  existing `ra.app.queue` for ordinary writes is untouched and still refuses
  money and emergencies (`neverQueue`).
- `incidents` gains four columns: `client_incident_id` (unique),
  `occurred_at`, `emergency_type`, `synced_at`. `occurred_at` and `created_at`
  can now be hours apart, and dispatch reads the first.
- Emergency analytics can separate an off-grid rescue from an ordinary one via
  the existing `degraded_path` flag, which every synced incident sets.
- The false-positive dataset ADR-0005 depends on still gets fed: an off-grid
  incident withdrawn before it is sent is deleted from the device, but one that
  has been sent must be cancelled through `POST /v1/sos/:id/cancel` so the
  cancellation is recorded rather than silently vanishing.
- We can demonstrate the claim rather than assert it. `scripts/ui-journey.mjs`
  drives the whole scenario in a real browser — online, network lost, SOS,
  local reference, GPS, local diagnosis, network restored, automatic sync,
  incident present in the database, replay produces no duplicate.

## What this ADR does not do

Named here so nobody has to infer it from silence. **Not implemented, and not
claimed anywhere in the product:** satellite communication, mesh networking
between nearby devices, government emergency-network integration, multi-network
intelligent routing, and on-device ML models beyond the deterministic rules
engine. Each is a plausible next step; none of them is shipped.
