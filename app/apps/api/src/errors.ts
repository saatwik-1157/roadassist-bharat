/**
 * The error vocabulary, in one place.
 *
 * Codes were previously invented at each call site — `not_found`, `forbidden`,
 * `offer_closed`, `conflict` — which is fine until a client wants to *act* on
 * one. A client cannot branch on a string it has to guess, and the difference
 * between "retry this" and "stop and tell the user" is exactly what a phone on
 * a bad connection needs to know.
 *
 * Two properties are load-bearing:
 *
 *   `retryable`   whether trying the same request again could plausibly work.
 *                 A 409 on a job somebody else took is NOT retryable; a 503
 *                 is. The client's queue reads this to decide between backing
 *                 off and surfacing the failure.
 *   `status`      the HTTP code, bound to the meaning rather than chosen per
 *                 handler, so the same condition cannot be a 400 in one route
 *                 and a 409 in another.
 *
 * Every envelope also carries the `requestId`, which is the same id the
 * structured logs are keyed on — a user can read it off the screen and it
 * leads straight to the request that produced it.
 */

export interface ErrorSpec {
  status: number;
  title: string;
  retryable: boolean;
}

export const ERRORS = {
  // ── authentication and authorisation ───────────────────────────────────
  AUTH_REQUIRED:        { status: 401, retryable: false, title: "Sign in to continue" },
  AUTH_EXPIRED:         { status: 401, retryable: true,  title: "Your session has ended. Sign in again." },
  FORBIDDEN:            { status: 403, retryable: false, title: "You do not have access to this" },
  // ── resources ──────────────────────────────────────────────────────────
  NOT_FOUND:            { status: 404, retryable: false, title: "Not found" },
  INCIDENT_NOT_FOUND:   { status: 404, retryable: false, title: "That emergency could not be found" },
  BOOKING_NOT_FOUND:    { status: 404, retryable: false, title: "That booking could not be found" },
  // ── request shape ──────────────────────────────────────────────────────
  INVALID_REQUEST:      { status: 400, retryable: false, title: "Some fields need fixing" },
  // ── state ──────────────────────────────────────────────────────────────
  INVALID_STATE:        { status: 409, retryable: false, title: "That is not possible in the current state" },
  ALREADY_ASSIGNED:     { status: 409, retryable: false, title: "Another provider has already taken this job" },
  OFFER_CLOSED:         { status: 409, retryable: false, title: "This offer is no longer open" },
  OFFER_EXPIRED:        { status: 409, retryable: false, title: "This offer expired before it was accepted" },
  CONFLICT:             { status: 409, retryable: true,  title: "This changed while your request was in flight. Reload and retry." },
  DUPLICATE:            { status: 409, retryable: false, title: "That reference is already in use" },
  // ── dispatch and payment ───────────────────────────────────────────────
  PROVIDER_UNAVAILABLE: { status: 409, retryable: true,  title: "No provider is free nearby right now" },
  PAYMENT_REQUIRED:     { status: 409, retryable: false, title: "This invoice has not been paid yet" },
  PAYMENT_FAILED:       { status: 402, retryable: true,  title: "The payment did not go through" },
  // ── platform ───────────────────────────────────────────────────────────
  RATE_LIMITED:         { status: 429, retryable: true,  title: "Too many requests" },
  SYNC_FAILED:          { status: 502, retryable: true,  title: "Synchronisation could not complete" },
  UNAVAILABLE:          { status: 503, retryable: true,  title: "This service is temporarily unavailable" },
  INTERNAL:             { status: 500, retryable: true,  title: "Something went wrong on our side" },
} as const satisfies Record<string, ErrorSpec>;

export type ErrorCode = keyof typeof ERRORS;

/**
 * An error that carries its own HTTP status and envelope.
 *
 * Thrown from anywhere; the server's single error handler renders it. Handlers
 * that already build a reply inline keep working unchanged — this is an
 * addition, not a migration that has to complete before anything is correct.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly detail?: Record<string, unknown>;

  constructor(code: ErrorCode, overrides: { title?: string; detail?: Record<string, unknown> } = {}) {
    const spec = ERRORS[code];
    super(overrides.title ?? spec.title);
    this.code = code;
    this.statusCode = spec.status;
    this.retryable = spec.retryable;
    this.detail = overrides.detail;
  }

  /** The wire shape. `requestId` is filled in by the handler that has the request. */
  envelope(requestId: string) {
    return {
      error: {
        code: this.code,
        title: this.message,
        retryable: this.retryable,
        requestId,
        ...(this.detail ?? {}),
      },
    };
  }
}

/** Shorthand for the common case. */
export const fail = (code: ErrorCode, title?: string, detail?: Record<string, unknown>) =>
  new ApiError(code, { title, detail });
