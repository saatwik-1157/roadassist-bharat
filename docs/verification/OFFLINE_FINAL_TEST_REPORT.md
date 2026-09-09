> Generated 2026-09-06 by executing the release candidate. Base commit
> `f771df5` plus uncommitted work. Evidence is named per row; where a step was
> proven by an automated suite rather than a hand-driven click, this file says
> which suite and which section, because that is a stronger claim, not a weaker
> one — it is repeatable.

# Offline / no-network — final test report

Executed in real Chrome by `npm run test:demo` beats 12 and 13, and by
`test:e2e` §10 and `test:ui` §7. Network was taken down through the app's own
connectivity control, which is what the demo does.

| # | Check | Result |
|---|---|---|
| 1 | Application enters OFF-GRID | **PASS** — `__ra.tier()` leaves `ONLINE`, asserted |
| 2 | UI states the connection clearly | **PASS** — pill turns red, banner explains what still works |
| 3 | Cached data remains accessible | **PASS** — cached tiles and last-known positions render |
| 4 | GPS behaviour correctly represented | **PASS** — GPS is a satellite receiver and needs no network; a fix is taken and labelled precise or approximate. It is never fabricated |
| 5 | Local diagnosis works | **PASS** — `__ra.diagnoseLocally()` answers offline from the same rule table the server uses |
| 6 | Local SOS capture | **PASS** — incident created on the device |
| 7 | Local incident ID generated | **PASS** — e.g. `RA-N9XRC5`, short enough to read aloud over a borrowed phone |
| 8 | Timestamp and location stored | **PASS** — `occurredAt` and the fix, or an explicit "unavailable" reason |
| 9 | Encrypted local storage | **PASS** — IndexedDB with AES-GCM-256 under a non-extractable `CryptoKey` |
| 10 | Sync journal created | **PASS** — journal entry with `op_id` and retry count |
| 11 | Reconnect | **PASS** — connectivity manager detects restoration |
| 12 | Synchronisation begins | **PASS** — `syncOffGrid()` forwards the incident |
| 13 | Server receives the operation | **PASS** — incident gains a server id |
| 14 | Duplicates prevented | **PASS** — re-syncing creates none; asserted in beat 13 and concurrency §5 |
| 15 | Final state correct | **PASS** — `status: "SYNCED"` with a `serverId` |
| 16 | UI updates | **PASS** — journal empties, platform reference shown |

**The strongest single check:** the tab is closed entirely and reopened, and the
incident is still there. Beat 12 does exactly that and asserts the count is
unchanged.

---

## NO NETWORK ≠ NO SAFETY

This section is the one that must not be overstated. Each line is what the code
does, not what would be nice.

### What works locally, with no network at all

- **GPS.** A satellite receiver transmits nothing and needs no internet.
- **Diagnosis.** The same rule table runs on the device. A CI test fails the
  build if the on-device table ever diverges from the server's.
- **Cached map tiles** and the last-known service positions.
- **An SOS becomes a real incident on this device** — its own reference, its
  own GPS fix, encrypted at rest, with a sync journal entry queued.

### What is queued

The incident itself, as a store-and-forward operation carrying a unique client
key. It retries with exponentially backed-off, fully jittered delays.

### What genuinely requires connectivity

- The SOS **reaching dispatch**
- Live mechanic tracking and ETAs
- Payment
- Any contact with emergency contacts or responders

### What the app says, and does not say

It says: **"Nothing has been transmitted."** It recommends calling **112**,
because voice often works on a signal too weak for data.

It never says "Emergency services contacted" — the string does not exist in the
codebase, verified by search across the whole repository. There is **no**
satellite link, **no** mesh networking and **no** SMS fallback that bypasses the
data network; each is named as future work in `app/README.md` and on the deck.
The Android app's SMS rung is a placeholder number until a real short code is
provisioned, and the UI says so on the home screen.

### After reconnect

The queued incident forwards itself. The unique client key makes a duplicate
impossible — a retry after a lost response converges on the incident that
already exists, which is the normal way retries duplicate things. One
emergency, not two.
