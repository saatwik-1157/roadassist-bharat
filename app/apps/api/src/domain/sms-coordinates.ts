/**
 * Reading a GPS fix out of an inbound SMS.
 *
 * The Android client's SOS body is `SOS <lat> <lng> RoadAssist` — see
 * `Emergency.smsBody` and `SosLadder.smsBody` in mobile/. This is the server
 * half of that contract, and it exists as its own module for two reasons: it is
 * the only part of `POST /v1/telecom/sms` that can be tested without a database,
 * and it is on the emergency path, where "probably fine" is not a standard.
 *
 * ── the rule ──────────────────────────────────────────────────────────────
 * Two numbers, both in range, or nothing. A partial or malformed pair is NOT
 * repaired, reordered or guessed at: a wrong location on an emergency is worse
 * than no location, because it sends a responder somewhere confidently.
 *
 * A human texting a bare `SOS` from a feature phone is the other half of the
 * traffic on this endpoint and is entirely valid — it simply has no fix, and
 * returns null here so the caller can ask for a landmark instead.
 */

export interface SmsFix {
  lat: number;
  lng: number;
}

/**
 * `words` is the already-lowercased, whitespace-split message, exactly as the
 * telecom endpoint parses it — the verb is words[0].
 *
 * Accepts the two tokens after the verb. Everything after them is ignored, so
 * the trailing "RoadAssist" the app appends (and any operator-added footer)
 * costs nothing.
 */
export function parseSmsCoordinates(words: string[]): SmsFix | null {
  const lat = toCoordinate(words[1]);
  const lng = toCoordinate(words[2]);
  if (lat === null || lng === null) return null;

  // Range, not just parseability. `Number("91")` is a fine number and an
  // impossible latitude, and ST_MakePoint would have stored it without
  // complaint — PostGIS does not validate degrees.
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;

  // 0,0 is Null Island: the value a broken GPS chip and an uninitialised
  // variable both produce. No road in India is within 2,000 km of it, and
  // dispatching to the Gulf of Guinea is not a better outcome than admitting we
  // have no fix.
  if (lat === 0 && lng === 0) return null;

  return { lat, lng };
}

/**
 * Strict numeric conversion.
 *
 * `Number()` alone is too permissive for this: it accepts "", " ", "0x1f",
 * "1e5", "Infinity" and "12,97" is NaN while "12.97" is not — and on an
 * emergency path an accidental hex parse is a silent 30-degree error. Only a
 * plain decimal, optionally signed, is a coordinate.
 */
function toCoordinate(token: string | undefined): number | null {
  if (token === undefined) return null;
  if (!/^[+-]?\d+(\.\d+)?$/.test(token)) return null;
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}
