/**
 * Rules-based implementations of the AI capabilities (ADR-0006).
 *
 * These are NOT scaffolding. They ship as the permanent production fallback and
 * define the baseline each future model must beat. The contract they satisfy is
 * the same one the models will satisfy, so swapping in a model changes nothing
 * upstream.
 *
 * Safety asymmetry: a model may only ever downgrade a drivability verdict to
 * unsafe. It can never upgrade one to safe. That rule lives here, in the merge.
 */

export interface Diagnosis {
  cause: string;
  confidence: number;
  severity: 1 | 2 | 3 | 4 | 5;
  driveable: boolean;
  parts: string[];
  advice: string;
}

interface Rule {
  cause: string;
  severity: Diagnosis["severity"];
  driveable: boolean;
  parts: string[];
  advice: string;
  /** Every keyword is lowercase; matching is substring-based on purpose so
   *  "wont start", "won't start" and "not starting" all hit. */
  keywords: string[];
  dtc?: string[];
}

const RULES: Rule[] = [
  {
    cause: "Battery discharged or terminals loose",
    severity: 3, driveable: false, parts: ["jump starter", "battery terminal cleaner", "12V battery"],
    advice: "A jump start will usually get you moving. If it dies again within the hour the battery needs replacing.",
    keywords: ["not start", "won't start", "wont start", "no crank", "click", "dead battery", "battery", "lights dim"],
    dtc: ["B1318", "P0562"],
  },
  {
    cause: "Flat or punctured tyre",
    severity: 2, driveable: false, parts: ["puncture kit", "spare tyre", "inflator"],
    advice: "Do not drive on a flat — it destroys the rim. Stop well off the carriageway before changing it.",
    keywords: ["flat", "puncture", "tyre", "tire", "wheel deflate", "air out"],
  },
  {
    cause: "Engine overheating — coolant loss or thermostat",
    severity: 5, driveable: false, parts: ["coolant", "radiator cap", "thermostat", "hose"],
    advice: "Stop immediately and let it cool for 30 minutes. Driving on will warp the head and turn this into an engine rebuild.",
    keywords: ["overheat", "temperature", "steam", "smoke from bonnet", "coolant", "hot engine"],
    dtc: ["P0217", "P0128"],
  },
  {
    cause: "Out of fuel",
    severity: 1, driveable: false, parts: ["5L fuel can"],
    advice: "Fuel delivery will have you moving in about half an hour. Diesel vehicles may also need bleeding.",
    keywords: ["fuel", "petrol", "diesel", "empty tank", "ran out"],
  },
  {
    cause: "Keys locked inside the vehicle",
    severity: 1, driveable: true, parts: ["lockout tool kit"],
    advice: "Do not break a window — a technician can open most vehicles without damage in a few minutes.",
    keywords: ["lock", "keys inside", "locked out", "key stuck"],
  },
  {
    cause: "Clutch or transmission fault",
    severity: 4, driveable: false, parts: ["clutch cable", "clutch plate", "transmission fluid"],
    advice: "Do not force the gearbox. This needs a workshop, so expect a tow rather than a roadside fix.",
    keywords: ["clutch", "gear", "transmission", "not engaging", "slipping"],
  },
  {
    cause: "Brake system fault",
    severity: 5, driveable: false, parts: ["brake fluid", "brake pads", "wheel speed sensor"],
    advice: "Do not drive. Brake faults do not get better on the way to the garage.",
    keywords: ["brake", "abs", "spongy", "grinding", "squeal"],
    dtc: ["C0035"],
  },
  {
    cause: "Engine misfire",
    severity: 4, driveable: false, parts: ["spark plugs", "ignition coil", "fuel injector"],
    advice: "Continued driving with a misfire can destroy the catalytic converter. Get it looked at before moving on.",
    keywords: ["misfire", "juddering", "shaking", "rough idle", "jerking", "loss of power"],
    dtc: ["P0300", "P0301"],
  },
  {
    cause: "EV traction battery or charging fault",
    severity: 4, driveable: false, parts: ["mobile charger", "HV diagnostic kit"],
    advice: "Do not attempt a jump start on a high-voltage system. A technician with EV certification is required.",
    keywords: ["ev", "charge", "charging", "range", "battery percent", "not charging", "state of charge"],
  },
];

const GENERIC: Diagnosis = {
  cause: "Cause not determined from the description",
  confidence: 0.25,
  severity: 3,
  driveable: false,
  parts: ["general diagnostic kit"],
  advice: "There is not enough detail to be confident. A technician will diagnose on site — please stay with the vehicle.",
};

/** Score a rule against free text and any scanned trouble codes. */
function score(rule: Rule, text: string, dtcs: string[]): number {
  let hits = 0;
  for (const k of rule.keywords) if (text.includes(k)) hits++;
  const dtcHit = rule.dtc?.some((d) => dtcs.includes(d.toUpperCase())) ?? false;
  if (!hits && !dtcHit) return 0;
  // A scanned code is hard evidence; free text is soft. Weight accordingly.
  const textScore = Math.min(hits / 2, 1) * 0.55;
  return dtcHit ? Math.min(0.95, 0.7 + textScore * 0.4) : Math.min(0.8, 0.35 + textScore);
}

export function diagnose(input: { symptoms?: string; dtcCodes?: string[]; vehicleClass?: string }): Diagnosis {
  const text = (input.symptoms ?? "").toLowerCase();
  const dtcs = (input.dtcCodes ?? []).map((d) => d.toUpperCase());
  if (!text && dtcs.length === 0) return GENERIC;

  const ranked = RULES
    .map((rule) => ({ rule, s: score(rule, text, dtcs) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);

  if (ranked.length === 0) return GENERIC;

  const { rule, s } = ranked[0];
  return {
    cause: rule.cause,
    confidence: Number(s.toFixed(2)),
    severity: rule.severity,
    driveable: rule.driveable,
    parts: rule.parts,
    advice: rule.advice,
  };
}

/**
 * Deterministic mechanic ranking — the fallback for the learning-to-rank model.
 * Distance dominates, rating and experience adjust, and a small exploration
 * bonus for newer mechanics keeps the marketplace from concentrating on a few
 * names (the fairness constraint from the AI roadmap).
 */
/**
 * A mechanic's displayed rating, shrunk toward the platform mean.
 *
 * A raw average is unusable at low volume: the first customer to leave 2 stars
 * would move a mechanic from 4.6 to 2.0 and effectively remove them from
 * dispatch, and one friendly 5 would do the reverse. Both are noise being read
 * as signal.
 *
 * So each mechanic starts with `PRIOR_WEIGHT` imaginary reviews at the platform
 * mean, and real reviews dilute that prior as they arrive:
 *
 *     (PRIOR_WEIGHT × PRIOR_MEAN + Σ ratings) / (PRIOR_WEIGHT + n)
 *
 * One 2★ then lands at 3.8 rather than 2.0, while a mechanic with fifty reviews
 * is governed almost entirely by their own record. This is the standard
 * Bayesian-average treatment for sparse ratings, and it is deterministic and
 * reproducible from the review rows and the mechanic's baseline — same
 * contract as everything else here.
 */
export const PRIOR_MEAN = 4.2;
export const PRIOR_WEIGHT = 5;

/**
 * `prior` is where the shrinkage points. It is the platform mean for a
 * mechanic we know nothing about — and the mechanic's own baseline when they
 * arrived with one (see `ratingPrior`).
 *
 * The prior used to be the platform mean for everybody, and the stored rating
 * was simply overwritten. A seeded 4.9 with 436 jobs behind it then took one
 * 5★ and landed on (5 × 4.2 + 5) / 6 = 4.33: the review was averaged against
 * five imaginary 4.2s while the mechanic's actual record was thrown away, and
 * a glowing review demoted them in dispatch. The prior's weight is unchanged,
 * so a baseline gets exactly the benefit of the doubt the platform mean did —
 * and is washed out by a real record just as surely.
 */
export function shrunkRating(sum: number, count: number, prior: number = PRIOR_MEAN): number {
  if (count <= 0) return Number(prior.toFixed(2));
  const value = (PRIOR_WEIGHT * prior + sum) / (PRIOR_WEIGHT + count);
  return Number(value.toFixed(2));
}

/** A rating on the 1–5 scale, as opposed to the column's 0 "never rated" default. */
const onScale = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 5;

/**
 * The baseline a mechanic's reviews are shrunk toward, decided when a review
 * lands.
 *
 * An existing baseline is kept: it was captured once and is never rewritten,
 * which is what keeps the stored rating reproducible from the review rows.
 * Otherwise, a mechanic with no earlier reviews still carries the rating they
 * arrived with (onboarding, or the seed standing in for it), and that becomes
 * the baseline. A mechanic who already had reviews without one was rated
 * against the platform mean, so they stay on it — capturing their current,
 * already-shrunk rating would count those reviews twice.
 *
 * Returns null for "no baseline": the platform mean applies.
 */
export function ratingBaseline(
  existing: number | null | undefined,
  storedRating: number | null | undefined,
  earlierReviews: number,
): number | null {
  if (onScale(existing)) return existing;
  if (earlierReviews === 0 && onScale(storedRating)) return storedRating;
  return null;
}

/** The prior `shrunkRating` should use for a mechanic with this baseline. */
export const ratingPrior = (baseline: number | null | undefined): number =>
  onScale(baseline) ? baseline : PRIOR_MEAN;

export function rankMechanics<T extends { distanceKm: number; rating: number; jobsCompleted: number }>(
  candidates: T[],
): Array<T & { score: number; etaMinutes: number }> {
  return candidates
    .map((m) => {
      const proximity = Math.max(0, 1 - m.distanceKm / 25);      // 0..1
      const quality = (m.rating || 3) / 5;                        // 0..1
      const exploration = m.jobsCompleted < 20 ? 0.06 : 0;        // help new entrants
      const score = proximity * 0.6 + quality * 0.34 + exploration;
      // 22 km/h effective urban speed, plus 4 minutes to get moving.
      const etaMinutes = Math.max(5, Math.round((m.distanceKm / 22) * 60) + 4);
      return { ...m, score: Number(score.toFixed(4)), etaMinutes };
    })
    .sort((a, b) => b.score - a.score);
}
