/**
 * Where a RAKSHA position came from, and how far it can be trusted.
 *
 * Two kinds of point share the authority map, and they are not equally real:
 *
 *   · a CITIZEN REPORT carries the reporting phone's own GPS fix, plus the
 *     radius the phone itself says that fix is good to (`coords.accuracy`).
 *     That radius is the one honest measure of precision we have, so it is
 *     stored and drawn, never smoothed into a confident dot.
 *   · a MODEL DETECTION on this build comes from RDD2022 photos, which carry no
 *     GPS at all. Their positions along NH-48 are placed by the simulator, and
 *     every surface says so.
 *
 * This module is the one place that turns those facts into words, so the API,
 * the dashboard and the tests all read from the same sentence. It is pure: no
 * database, no clock, no locale.
 *
 * ── the accuracy rule ─────────────────────────────────────────────────────
 * A radius is kept only if it is a real, finite, non-negative number of metres.
 * Anything else (NaN, a negative, a string, nothing) becomes null and is shown
 * as "accuracy not reported". A bad radius never rejects the report itself: the
 * hazard is still real, and dropping it over a malformed optional field would
 * lose the one thing the person took the trouble to send. It is also never
 * replaced by a plausible-looking guess.
 *
 * A radius above ACCURACY_CEILING_M is not a GPS fix; it is a coarse network
 * guess (a desktop browser's IP location reports tens of kilometres). It is
 * capped for storage so one such report cannot paint a circle over half a
 * state, and the cap is always SAID ("or worse"), so the capped figure is never
 * read as a measurement.
 */

/** Above this, a fix is too coarse to be worth drawing at its full size. */
export const ACCURACY_CEILING_M = 10_000;

/** A radius worth storing, in metres to 0.1 m, or null if the phone gave none. */
export function normaliseAccuracyM(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const capped = Math.min(value, ACCURACY_CEILING_M);
  return Math.round(capped * 10) / 10;
}

/** "GPS ±8 m", "GPS ±1.2 km", "GPS ±10 km or worse", or "accuracy not reported". */
export function formatAccuracy(accuracyM: number | null | undefined): string {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM < 0) return "accuracy not reported";
  if (accuracyM >= ACCURACY_CEILING_M) return `GPS ±${ACCURACY_CEILING_M / 1000} km or worse`;
  if (accuracyM < 1) return "GPS ±<1 m";
  if (accuracyM < 1000) return `GPS ±${Math.round(accuracyM)} m`;
  const km = (accuracyM / 1000).toFixed(1).replace(/\.0$/, "");
  return `GPS ±${km} km`;
}

export type PositionProvenance = "phone_gps" | "simulated" | "device_gps";

export interface PositionSource {
  /** "citizen" for a crowdsourced report; anything else is a device sighting. */
  source: string | null | undefined;
  /** The edge device's honest-labelling flag (edge_devices.simulated). */
  simulated: boolean | null | undefined;
  modelVersion: string | null | undefined;
  accuracyM: number | null | undefined;
}

export interface PositionDescription {
  provenance: PositionProvenance;
  /** The measured radius in metres, or null. Never estimated. */
  accuracyM: number | null;
  /** One line for a popup. Time is left to the viewer's own locale. */
  label: string;
}

/**
 * The simulator's rule-based patrol has no image at all, so the RDD2022
 * explanation would misattribute its positions. Its model id says what it is.
 */
const SIMULATED_PATROL = /^sim-rules/;

export function describePosition(p: PositionSource): PositionDescription {
  const accuracyM = normaliseAccuracyM(p.accuracyM ?? undefined);

  if (p.source === "citizen") {
    // With a radius, the position is a phone's measured fix. Without one we
    // know a person submitted it, and nothing about how precisely — so the
    // label claims no more than that.
    return {
      provenance: "phone_gps",
      accuracyM,
      label: accuracyM === null
        ? "Citizen report · accuracy not reported"
        : `Reported from a phone · ${formatAccuracy(accuracyM)}`,
    };
  }

  if (p.simulated !== false) {
    // Unknown counts as simulated: the flag defaults to true until a real
    // hardware deployment flips it, and a missing value must not upgrade a
    // placed point into a surveyed one.
    return {
      provenance: "simulated",
      accuracyM: null,
      label: SIMULATED_PATROL.test(p.modelVersion ?? "")
        ? "Location SIMULATED (simulated patrol, no real GPS)"
        : "Location SIMULATED (RDD2022 images carry no GPS)",
    };
  }

  return {
    provenance: "device_gps",
    accuracyM,
    label: `Edge device GPS · ${formatAccuracy(accuracyM)}`,
  };
}
