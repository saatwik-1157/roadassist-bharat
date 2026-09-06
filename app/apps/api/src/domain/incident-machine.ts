/**
 * The emergency state machine.
 *
 * Bookings have had a guarded state machine since Phase 5; incidents did not.
 * They were moved with direct `UPDATE`s scattered across three handlers, which
 * meant the rules that matter most in this codebase — a model can never
 * dispatch, a cancelled emergency can never quietly resume, an incident cannot
 * be resolved before anyone responded — lived in prose rather than in code.
 *
 * The transitions here are the same table ADR-0005 describes, made executable.
 *
 *   DETECTED ─────────────► AWAITING_CONFIRMATION ──► CONFIRMED ──► RESPONDING ──► RESOLVED
 *      │                             │                    │             │
 *      └──────────── CANCELLED ◄─────┴────────────────────┴─────────────┘
 *
 * The brief's vocabulary maps onto these one-to-one; `PUBLIC_STAGE` below is
 * that mapping, kept in one place so the wire never disagrees with the column.
 */

export const INCIDENT_STATUSES = [
  "DETECTED", "AWAITING_CONFIRMATION", "CONFIRMED", "CANCELLED", "RESPONDING", "RESOLVED",
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export type IncidentCommand =
  | "raise"        // a device or a person reports an emergency
  | "confirm"      // a human (or a corroborating second signal) stands behind it
  | "escalate"     // contacts alerted, responder searched — help is being summoned
  | "resolve"      // the emergency is over
  | "cancel";      // false alarm

/**
 * from → command → to.
 *
 * `escalate` is reachable only from CONFIRMED. That single line is ADR-0005's
 * central rule expressed as code rather than as a comment: a model-detected
 * crash lands in AWAITING_CONFIRMATION and there is no path from there to
 * RESPONDING that does not pass through a human confirmation.
 */
const TRANSITIONS: Record<IncidentStatus, Partial<Record<IncidentCommand, IncidentStatus>>> = {
  DETECTED:              { confirm: "CONFIRMED", cancel: "CANCELLED" },
  AWAITING_CONFIRMATION: { confirm: "CONFIRMED", cancel: "CANCELLED" },
  // Escalating twice is idempotent rather than illegal: an emergency retried on
  // a bad connection must never be refused for having already been tried.
  CONFIRMED:             { escalate: "RESPONDING", resolve: "RESOLVED", cancel: "CANCELLED" },
  RESPONDING:            { escalate: "RESPONDING", resolve: "RESOLVED", cancel: "CANCELLED" },
  // Terminal. A resolved or cancelled emergency is a historical record; a new
  // one is a new incident, with its own reference and its own audit trail.
  RESOLVED:              {},
  CANCELLED:             {},
};

/** The stage names the product speaks, derived from the stored status. */
export const PUBLIC_STAGE: Record<IncidentStatus, string> = {
  DETECTED: "SOS_CREATED",
  AWAITING_CONFIRMATION: "SOS_CREATED",
  CONFIRMED: "SOS_RECEIVED",
  RESPONDING: "RESPONDING",
  RESOLVED: "RESOLVED",
  CANCELLED: "CANCELLED",
};

export const isIncidentTerminal = (s: IncidentStatus) => s === "RESOLVED" || s === "CANCELLED";

export function allowedIncidentCommands(from: IncidentStatus): IncidentCommand[] {
  return Object.keys(TRANSITIONS[from] ?? {}) as IncidentCommand[];
}

export class IllegalIncidentTransition extends Error {
  readonly statusCode = 409;
  readonly code = "invalid_state";
  constructor(readonly from: IncidentStatus, readonly command: IncidentCommand) {
    const allowed = allowedIncidentCommands(from);
    super(
      `Cannot "${command}" an incident in ${from}. ` +
      (allowed.length
        ? `Allowed here: ${allowed.join(", ")}.`
        : "This emergency is closed — raise a new one."),
    );
  }
}

export function applyIncident(from: IncidentStatus, command: IncidentCommand): { to: IncidentStatus } {
  const to = TRANSITIONS[from]?.[command];
  if (!to) throw new IllegalIncidentTransition(from, command);
  return { to };
}

/**
 * Where an incident starts.
 *
 * A manual SOS is already a human act at the moment the button is held, so it
 * begins CONFIRMED. A model signal begins AWAITING_CONFIRMATION and stays there
 * until a person says otherwise — the one rule that is never relaxed for
 * convenience.
 */
export function initialStatus(detectedByModel: boolean): IncidentStatus {
  return detectedByModel ? "AWAITING_CONFIRMATION" : "CONFIRMED";
}
