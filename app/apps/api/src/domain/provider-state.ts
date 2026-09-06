/**
 * What a provider is doing right now.
 *
 * ── why this is derived, not stored ───────────────────────────────────────
 * The obvious implementation adds a `status` column to `mechanics` and writes
 * it on every transition. That column then has to be kept in step with the
 * booking state machine, the offer table and the duty toggle — three writers,
 * none of them transactional with each other. The first crash between "booking
 * moved to EN_ROUTE" and "mechanic set to EN_ROUTE" leaves a provider who is
 * permanently BUSY with no job, or AVAILABLE while driving to one.
 *
 * A provider's state is already fully determined by facts the database holds
 * and enforces: their duty flag, whether they hold a live offer, and the status
 * of the booking assigned to them. Deriving it cannot drift, needs no
 * migration, and has no window in which it is wrong.
 *
 * The cost is a join on read. `deriveProviderState` takes those facts as plain
 * arguments so the rule is unit-testable without a database, and the SQL that
 * gathers them lives beside the dispatch query that needs it.
 */

/** The vocabulary the dispatch brief asks for, in escalating commitment. */
export const PROVIDER_STATES = [
  "OFFLINE",    // off duty — invisible to dispatch
  "AVAILABLE",  // on duty, nothing in hand
  "OFFERED",    // on duty, holding at least one live offer
  "BUSY",       // accepted a job, not yet moving
  "EN_ROUTE",   // driving to the customer
  "ON_JOB",     // on site, working, or waiting on parts
] as const;

export type ProviderState = (typeof PROVIDER_STATES)[number];

/** Booking states in which a provider is committed to a customer. */
const COMMITTED = {
  BUSY: new Set(["ASSIGNED"]),
  EN_ROUTE: new Set(["EN_ROUTE"]),
  ON_JOB: new Set(["ON_SITE", "IN_PROGRESS", "AWAITING_PARTS", "ESCALATED"]),
} as const;

export interface ProviderFacts {
  /** The mechanic's own duty toggle. */
  isAvailable: boolean;
  /** Status of the booking currently assigned to them, if any. */
  activeBookingStatus?: string | null;
  /** Live, unexpired offers they are holding. */
  liveOffers?: number;
}

/**
 * Collapse the facts into one state.
 *
 * Order matters and encodes the priority: a committed job beats an outstanding
 * offer, and going off duty never hides a job already accepted — a provider who
 * flips their toggle mid-drive is still EN_ROUTE, because a customer is waiting
 * for them and pretending otherwise would lose the job.
 */
export function deriveProviderState(facts: ProviderFacts): ProviderState {
  const booking = facts.activeBookingStatus ?? null;
  if (booking) {
    if (COMMITTED.ON_JOB.has(booking)) return "ON_JOB";
    if (COMMITTED.EN_ROUTE.has(booking)) return "EN_ROUTE";
    if (COMMITTED.BUSY.has(booking)) return "BUSY";
  }
  if (!facts.isAvailable) return "OFFLINE";
  if ((facts.liveOffers ?? 0) > 0) return "OFFERED";
  return "AVAILABLE";
}

/**
 * May dispatch offer this provider a NEW job?
 *
 * OFFERED is deliberately allowed. A provider holding an offer for one job has
 * not committed to it, and a marketplace where a live offer blocks every other
 * one would leave a stranded customer waiting on somebody who is not going to
 * answer. The accept path is already race-safe (ADR-0010), so at most one of
 * the two can land.
 *
 * Everything from BUSY onward is refused. That was the bug: dispatch filtered
 * only on `is_available`, so a mechanic already driving to one breakdown kept
 * receiving offers for the next.
 */
export function isOfferable(state: ProviderState): boolean {
  return state === "AVAILABLE" || state === "OFFERED";
}

/** Plain-language label for the customer's tracking screen. */
export function describeProviderState(state: ProviderState): string {
  switch (state) {
    case "OFFLINE": return "Off duty";
    case "AVAILABLE": return "Available";
    case "OFFERED": return "Considering a request";
    case "BUSY": return "Assigned, preparing to leave";
    case "EN_ROUTE": return "On the way";
    case "ON_JOB": return "Working on a job";
  }
}
