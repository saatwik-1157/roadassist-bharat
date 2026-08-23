# ADR-0008 — Edge devices are authenticated principals, never anonymous

Status: Accepted · 2026-08-23 · Owner: platform

## Context

RAKSHA devices upload detections from unattended locations. An anonymous
ingestion endpoint would let anyone fabricate road hazards (the threat model's
fake-SOS flood, threat 4, applied to infrastructure). Human auth here is
MSISDN + OTP — meaningless for a roadside camera.

## Decision

Devices become the platform's first machine principals, reusing the existing
JWT machinery rather than inventing a parallel scheme:

1. **Registration** is a human act: an ADMIN or GOV_OFFICER calls
   `POST /v1/raksha/devices`; the server generates a 32-byte secret, returns it
   **once**, and stores only its SHA-256 (`edge_devices.credential_hash`) —
   exactly how refresh tokens and OTPs are already stored.
2. **Token exchange**: the device trades `deviceId + secret` at
   `POST /v1/raksha/devices/token` (constant-time comparison) for a short-lived
   access JWT with claims `{ sub: deviceId, roles: ["device"] }`, signed and
   verified by the existing `auth.ts` — no new verifier.
3. **Authorization**: ingestion routes require role `device`; a device may
   write only rows attributed to its own `sub` (ownership at the resource,
   the house convention). `device` is a claim-level role — it does not join the
   human `role_name` enum because devices are not users.
4. **No secrets in code**: credentials are generated at registration, never
   hardcoded, never logged; the simulator stores its credential in a gitignored
   state file.

## Consequences

Registration is the trust root: compromising a device leaks only that device's
identity, revocable by soft-deleting its row (token TTL bounds the exposure).
A dedicated rotation endpoint and per-device rate limits are accepted debt,
scheduled for the security hardening phase (17) and documented in the
requirements. `last_seen_at` + heartbeats give the fleet-health view.
