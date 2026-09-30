# ADR-0012 — Location services come from open map data, fetched by the server, coarsened, and off in every test run

**Status:** Accepted · 2026-09-30 · Owner: platform

## Context

The platform knew where a stranded driver was and could not say anything useful
about the place. The citizen app showed a position and a straight-line distance;
it could not name the road, list the nearest hospital or police station, or say
how long a mechanic would take by road. The RAKSHA dashboard showed a detection
at a coordinate with no readable place, and its corridor report knew the
weather but not the air, on a corridor (NH-48) where winter smog is itself a
visibility hazard.

All of that exists as open data behind public services: OpenStreetMap's
Nominatim (addresses) and Overpass (places by tag), the OSRM demo router (road
distance and time), Open-Meteo's air-quality API and the USGS earthquake feed.
None needs an account. Three of them run on donated capacity and publish their
terms: identify the application, cache, and stay at or below about one request a
second.

Two constraints decide how they may be used:

1. **Non-negotiable #4, "no PII leaves India".** A signed-in user's position is
   personal data. Every one of these hosts is outside India (the OSM services in
   the EU and Germany, OSRM's demo server in Germany, USGS in the USA). A lookup
   about a user's position is therefore in direct tension with #4, however it is
   made.
2. **`npm run residency` refuses to let a page load a third-party resource.** A
   browser calling Nominatim directly would hand each visitor's IP address and
   exact position to the host, which is the thing the gate exists to stop.

## Decision

**Location lookups are made by the server, with coarsened coordinates, paced and
cached to the providers' terms, declared as egress, and switched off in
development, test and CI.**

1. **Server-side only.** Four authenticated routes in
   `apps/api/src/routes/geo.ts` (`/v1/geo/address`, `/nearby`, `/route`,
   `/earthquakes`), plus an `airQuality()` helper used by the RAKSHA corridor
   report. The pages call only this platform; `apps/web/near.js` makes no
   network call of its own. The visitor's IP address never reaches a provider.
2. **Coarsened before it leaves.** Addresses and routes round to 3 decimal
   places (about 110 m); a nearby search rounds to 2 (about 1 km), because the
   answer is a list of public places and precision there buys nothing. Air
   quality is asked only at the corridor's fixed segment midpoints, never at a
   user's position. The earthquake query carries a fixed India bounding box and
   a date. A point outside India is refused with `400 outside_region` before any
   provider is asked.
3. **The providers' terms as mechanism.** An identifying User-Agent on every
   call; a `Pacer` per provider that runs calls one at a time at least a gap
   apart (1.1 s Nominatim, 1 s OSRM, 2 s Overpass) and refuses a queue that grows
   too long; TTL caches (address 24 h, nearby 6 h, route 10 min, earthquakes
   15 min, air quality 30 min), which keep a "no result" too, so an empty spot is
   not asked about again. The public Overpass server is slow and often busy, so
   a 429/502/503/504 from it gets one paced retry.
4. **Declared egress.** Five hosts are added to `DECLARED_EGRESS` in
   `scripts/check-data-residency.mjs`, each with its region and what it
   receives, and the Nominatim entry states the tension with #4 in so many
   words.
5. **Off where tests run.** `GEO_SERVICES` is unset by default, which means off
   when `NODE_ENV` is `development`, `test` or `ci` (the same allow-list as
   `isLocalEnv`) and on anywhere else. `on`/`off` override it. No test run, CI
   job or developer's afternoon sends a request to a donated service unless
   somebody asked for it.
6. **Say it failed; never invent.** Off answers `503 geo_disabled`; a provider
   that fails or a full queue answers `503 geo_unavailable`. The screens say the
   lookup is unavailable. A phone link appears only when the map has a phone
   number, an unnamed place is labelled unnamed, distances on the nearby list
   are labelled straight-line, a road time is labelled as having no live
   traffic, and a RAKSHA device detection's address is labelled "Simulated point
   near …", because its position is simulated.

## The tension with non-negotiable #4, stated rather than hidden

Coarsening reduces what leaves; it does not make it anonymous. A position
rounded to about 110 m, sent from our server with no user identifier, is still
a statement about where a person was. So this is a documented exception, not a
claim of compliance. It is acceptable **for the demo** only because the demo
already runs in Singapore (the README says so under #4), and the whole platform
is outside India there. It is **not** acceptable for production.

## Alternatives

**Self-hosted Nominatim and OSRM in an Indian region.** Both are open source and
run on an OpenStreetMap extract of India, so a position would never leave the
country; Overpass has the same answer. This is the production answer. It is
not built now because it needs a server with the memory and disk to import the
extract and keep it updated, which the free tiers this demo runs on do not
provide.

**Keyed services: openrouteservice (routing), Open Charge Map (EV chargers).**
Richer data, and in Open Charge Map's case a better charger list than OSM
tags. Rejected for now because both need an account and an API key, and the
project has neither. Adding them later is a new egress row and a key in the
environment, not a redesign.

**Calling the providers from the browser.** Simpler, and no server load. Rejected
outright: it discloses every visitor's IP address and exact position to a third
party, and the residency gate refuses it.

**No location services at all.** The honest default, and still what a test run
gets. Rejected for the deployed demo because "nearest hospital" and "road time
to the mechanic" are the questions a stranded driver actually has.

## Consequences

- The citizen home screen has a "Near you" card: the nearest address and the
  nearest hospitals, police, fuel, EV charging and repair shops, with
  `tel:` links only where the map has a number and a "call 112" line under
  every result. It
  loads by itself only when location permission is already granted; otherwise
  it waits for a tap, so nobody is prompted unasked. A live rescue's tracking
  card adds a road distance and time next to the straight-line figure.
- The RAKSHA corridor report adds air quality at both corridor ends and a "poor
  air quality" risk factor when the US AQI is above 150. The dashboard gains a
  "Corridor conditions" panel (weather risk, lowest visibility, air quality,
  earthquakes of magnitude 4+ in the last 7 days) and a readable place for a
  detection's photo.
- Dispatch is unchanged. It still finds candidate mechanics by PostGIS distance
  (`dispatch.ts`); the OSRM time is shown to the citizen and decides nothing.
- The data is community map data. A hospital can be missing, closed or mapped
  in the wrong place, and opening hours can be stale; the card says to call
  before relying on them.
- The public Overpass server is the weak link: it is slow and often answers
  429/504 when busy. The paced retry and the six-hour cache hide most of that,
  not all of it; see ENGINEERING-NOTES.md.
- Because the routes are off in development, test and CI, the live behaviour of
  the providers is not covered by any automated suite. The unit tests
  (`apps/api/test/geo.test.ts`) cover coarsening, the region check, the on/off
  rule, the cache, the pacer and every parser against recorded shapes; the e2e
  journey checks authentication, the region refusal, the `geo_disabled` answer
  and input validation. Neither proves that a provider answers.
- Five more hosts outside India are declared. Before this platform is deployed
  for real users, each of the three that receive a user's position
  (Nominatim, Overpass, OSRM) must be replaced by a self-hosted instance in an
  Indian region, or the feature switched off with `GEO_SERVICES=off`.
