# Off-Grid Mode

> *"RoadAssist doesn't stop when the network stops."*

Design decisions: [ADR-0009](adr/0009-offgrid-mode.md).
Conflict rules: [ADR-0004](adr/0004-offline-conflict-rules.md).
Failure behaviour: [architecture/failure-matrix.md](architecture/failure-matrix.md).

---

## Capability matrix

What the platform can actually do with no internet. Every **YES** below is
exercised by an automated test; every **NO** is a real limitation, not a
simplification.

| Capability | Online | Off-grid | Why |
|---|---|---|---|
| View the active off-grid incident | YES | **YES** | Read from IndexedDB; the screen renders with no network, no session and no server |
| Create a local incident | YES | **YES** | Incident and journal entry written in one transaction |
| SOS capture | YES | **YES** | Local reference `RA-XXXXXX`, GPS, timestamp, vehicle, emergency type |
| SOS **delivered to dispatch** | YES | **NO** | Nothing is transmitted. The app says so in those words |
| GPS position | YES | **YES\*** | A satellite receiver needs no internet. \*A cold start with no assistance data can take minutes, and indoors it may never fix — the app reports "Unknown", never a fallback coordinate |
| Cloud AI diagnosis | YES | **NO** | There is no model to reach |
| Local rules diagnosis | YES | **YES** | The same rule table the server uses; a CI test fails the build if they diverge. Labelled `LOCAL OFFLINE DIAGNOSIS` |
| Cached map tiles | YES | **YES** | Pre-downloaded by Trip Guardian and by the service worker |
| Last-known nearby services | YES | **YES** | From the last `/v1/map/live` snapshot, shown with its timestamp |
| Live mechanic position / ETA | YES | **NO** | There is nothing live to show, and a stale pin presented as live is the exact failure this feature exists to prevent |
| Live dispatch | YES | **NO** | Needs the platform |
| Payment | YES | **NO** | Never queued. Replaying a payment could charge twice |
| Booking state changes | YES | **NO** | Server-authoritative (ADR-0004). Never queued |
| Add a vehicle / file a hazard report | YES | **QUEUED** | Safe to replay; the server de-duplicates by operation id |
| Cloud synchronisation | YES | **QUEUED** | Store-and-forward, exponential backoff with full jitter |
| App shell / PWA start | YES | **YES** | Service worker `ra-v4` caches the shell, both consoles and the fonts |
| Emergency instructions | YES | **YES** | Static text on the device |

---

## The three tiers

| Tier | Decided by | Behaviour |
|---|---|---|
| `ONLINE` | Probe succeeded and was fast, radio up | Everything |
| `LIMITED` | Probe slow (≥2.5 s), probe failing, 2g / save-data, or recent transport failures | Requests still attempted; whatever fails is stored, not lost |
| `OFF-GRID` | `navigator.onLine === false`, simulated, or repeated failures with no probe | Local emergency mode |

`navigator.onLine` reports whether the OS has a network *interface* — a phone
camped on a cell with no backhaul says `true`. It is therefore one input among
several, and it can only ever make the verdict **worse**, never better. The
decision function is pure and unit-tested (`classifyConnectivity`).

`GET /v1/ping` touches no database; `/health` does. That is what keeps "the
network is dead" and "the platform is sick" distinguishable from a phone at the
roadside.

---

## What a user is told, exactly

On raising an SOS with no connection:

> **OFF-GRID SOS CREATED**
> No network connection detected.
> Your emergency information is stored securely on this device and will be
> synchronized automatically when connectivity returns.
>
> Nothing has been transmitted. No mechanic, responder or emergency contact has
> been alerted, and none can be until this device reaches a network. If you can
> reach a phone line, call 112 now.

On reconnect: **Connection restored** → *Synchronizing emergency information…*
→ **SOS synchronized. RoadAssist dispatch can now process your incident.**
Or, on failure: **Sync retry pending** — and the incident stays on the device.

The phrase *"Emergency services contacted"* appears nowhere in the codebase.

---

## Storage and retention

`IndexedDB` database `roadassist-offgrid`, three stores: `incidents`, `journal`,
`meta`.

**Encryption.** Payloads are AES-GCM-256 under a **non-extractable** `CryptoKey`
generated on the device and held in IndexedDB — the browser will use it but will
not hand its bytes to any script. That protects a copy of the storage taken off
the device: a forensic dump, a shared phone, a backup.

It is **not** protection against code running on this origin, which can ask the
store to decrypt. The UI says exactly that. Where WebCrypto is unavailable (a
plain-http origin that is not localhost) the store falls back to plaintext and
**says so on screen** rather than implying protection it does not have.

**Never stored:** access token, refresh token, payment credential, server secret.
The journal has never needed one, so it has never held one.

**Retention:** a synchronised incident is deleted 24 hours after it reaches the
platform. An unsynchronised one is **never** deleted, at any age — losing
somebody's emergency to a retention timer is not an acceptable trade.

---

## The sync journal

```
OFFLINE JOURNAL → AUTHENTICATE → SEND → SERVER VALIDATION →
IDEMPOTENCY CHECK → DATABASE UPDATE → MARK SYNCHRONIZED
```

Each entry carries an operation id (which *is* the idempotency key), the incident
id, a type, a timestamp, the payload, a sync status, a retry count and a SHA-256
integrity digest.

- `incidents.client_incident_id` is **UNIQUE**, so a retry after a lost
  response — the normal way retries duplicate things — converges on the incident
  it already created rather than raising a second emergency.
- Retries use exponential backoff with **full jitter**, so a convoy leaving a
  tunnel does not stampede the platform in the same second.
- Entries are never dropped. Past the automatic retry ceiling the record stays
  for a manual "Sync now".
- The integrity digest is **evidence, not authorisation**: it proves the payload
  the server received is the one the device wrote, catching a truncated record.
  It proves nothing about who wrote it — that is the access token's job, and the
  server re-validates every field regardless.

**Syncing records an incident; it does not alert anybody.** Escalation stays an
explicit `POST /v1/sos/:id/confirm`, called as a visible step of the reconnection
flow. An incident that may be hours old must not silently SMS a family at 3am.

## Conflicts

Booking status is server-authoritative. A device that left the network at
`EN_ROUTE` and reconnects after the mechanic marked `ARRIVED` does not overwrite
the newer state: the operation is refused, written to `conflict_log` with the
rule that fired (`server_wins`), and the device is handed the authoritative value
in the same response.

---

## Future, and labelled as such everywhere in the product

Not implemented, not claimed: **satellite communication**, **mesh networking**
between nearby devices, **government emergency-network integration**,
**multi-network intelligent routing**, and **on-device ML** beyond the
deterministic rules engine.

The one partial: cellular/SMS fallback is genuinely implemented on the **Android**
client (`Emergency.kt` — data → `SmsManager` with delivery confirmation → 112
dialer → device queue) and on the **server** (inbound `POST /v1/telecom/sms`
raises an SOS from a feature phone with no app). A **browser** cannot originate
an SMS — the web platform gives a page no such API — so the web app tells the
user to call 112 rather than pretending it sent one.
