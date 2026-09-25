/**
 * The booking state machine.
 *
 * ADR-0004: booking state is server-authoritative. A client sends a *command*;
 * only this table decides whether the resulting transition is legal. An offline
 * client replaying a queued operation goes through exactly the same guard.
 */

export const STATUSES = [
  "DRAFT", "REQUESTED", "MATCHING", "NO_SUPPLY", "ASSIGNED", "EN_ROUTE", "ON_SITE",
  "IN_PROGRESS", "AWAITING_PARTS", "ESCALATED", "COMPLETED", "PAID", "CANCELLED",
] as const;

export type Status = (typeof STATUSES)[number];

export type Command =
  | "submit" | "dispatch.start" | "mechanic.accept" | "offers.exhausted"
  | "retry.widen" | "mechanic.start_travel" | "arrive" | "work.start"
  | "parts.required" | "parts.received" | "work.complete" | "tow.required"
  | "tow.assigned" | "payment.settled" | "cancel";

/** from → command → to. Anything not listed here is rejected. */
const TRANSITIONS: Partial<Record<Status, Partial<Record<Command, Status>>>> = {
  DRAFT:          { submit: "REQUESTED", cancel: "CANCELLED" },
  REQUESTED:      { "dispatch.start": "MATCHING", cancel: "CANCELLED" },
  MATCHING:       { "mechanic.accept": "ASSIGNED", "offers.exhausted": "NO_SUPPLY", cancel: "CANCELLED" },
  NO_SUPPLY:      { "retry.widen": "MATCHING", cancel: "CANCELLED" },
  ASSIGNED:       { "mechanic.start_travel": "EN_ROUTE", cancel: "CANCELLED" },
  EN_ROUTE:       { arrive: "ON_SITE", cancel: "CANCELLED" },
  ON_SITE:        { "work.start": "IN_PROGRESS", cancel: "CANCELLED" },
  IN_PROGRESS:    { "work.complete": "COMPLETED", "parts.required": "AWAITING_PARTS", "tow.required": "ESCALATED" },
  AWAITING_PARTS: { "parts.received": "IN_PROGRESS", cancel: "CANCELLED" },
  ESCALATED:      { "tow.assigned": "ASSIGNED", cancel: "CANCELLED" },
  COMPLETED:      { "payment.settled": "PAID" },
  PAID:           {},
  CANCELLED:      {},
};

/** States after which the customer owes a cancellation fee. */
const FEE_AFTER: ReadonlySet<Status> = new Set<Status>(["ASSIGNED", "EN_ROUTE", "ON_SITE"]);

export const isTerminal = (s: Status) => s === "PAID" || s === "CANCELLED";

/**
 * Does entering `to` finish a job for the assigned mechanic's record?
 *
 * `mechanics.jobs_completed` is what the console shows a mechanic and what
 * `rankMechanics` reads for its newcomer bonus, and nothing ever advanced it:
 * a mechanic stayed at whatever the seed invented however many jobs they did.
 *
 * It counts on COMPLETED rather than PAID. The work is done when the mechanic
 * marks it done; whether and how the customer pays is a separate fact, and a
 * job paid in cash that is never recorded is still a job the mechanic did.
 * COMPLETED also has exactly one way in (IN_PROGRESS → work.complete) and no
 * way back from anything after it, so counting on entry counts each booking
 * once — booking-machine tests pin that property, because the counter's
 * idempotency rests on it. PAID has four doors (pay, confirm, webhook and the
 * payment.settled record), and every one of them would need the same guard.
 */
export const finishesJob = (to: Status) => to === "COMPLETED";

export function canApply(from: Status, command: Command): boolean {
  return Boolean(TRANSITIONS[from]?.[command]);
}

export function allowedFrom(from: Status): Command[] {
  return Object.keys(TRANSITIONS[from] ?? {}) as Command[];
}

export class IllegalTransition extends Error {
  readonly statusCode = 409;
  readonly code = "illegal_transition";
  constructor(readonly from: Status, readonly command: Command) {
    super(`Cannot apply "${command}" to a booking in ${from}. Allowed here: ${allowedFrom(from).join(", ") || "nothing — this booking is finished"}.`);
  }
}

export function apply(from: Status, command: Command): { to: Status; cancellationFee: boolean } {
  const to = TRANSITIONS[from]?.[command];
  if (!to) throw new IllegalTransition(from, command);
  return { to, cancellationFee: command === "cancel" && FEE_AFTER.has(from) };
}
