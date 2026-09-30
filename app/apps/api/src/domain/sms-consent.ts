/**
 * SMS opt-out: which words mean STOP and START, and what STOP stops.
 *
 * `STOP` used to be answered with "you will receive no further messages" and
 * nothing was stored, so the promise was false the moment it was sent. The
 * store is `sms_opt_outs` (migration 0007); this module is the rule, kept pure
 * so it can be tested without a database.
 *
 * ── the rule ──────────────────────────────────────────────────────────────
 * The legal norm is that an opt-out is honoured, and it is honoured here —
 * including for emergency-contact alerts. A contact who texted STOP is not
 * texted when somebody who lists them raises an SOS. That is a real cost and it
 * is taken deliberately: the contact never signed up, somebody else typed their
 * number in, and STOP is the only way they have to tell us to stop. Overriding
 * it "for their own good" is exactly what opt-out law exists to forbid. The
 * STOP reply says so in plain words, the person raising the SOS is told how
 * many of their contacts were not alerted and why, and START undoes it.
 *
 * What STOP does not stop is an answer to a message the number itself just
 * sent. Somebody who texted STOP and later texts HELP CAR or SOS is asking for
 * a reply; answering is not outreach. (A sign-in code is the same case — it is
 * sent only because somebody asked for it on a sign-in screen — and routes/auth
 * does not consult this list.)
 */

/**
 * The opt-out and opt-in words. The industry-standard set, minus CANCEL: on
 * this line CANCEL already means "cancel my booking", and a person cancelling a
 * mechanic must not silently unsubscribe from their own emergency alerts.
 */
export const STOP_WORDS: readonly string[] = ["stop", "stopall", "unsubscribe", "quit", "end", "optout"];
export const START_WORDS: readonly string[] = ["start", "unstop", "subscribe", "optin", "resume"];

export type ConsentKeyword = "stop" | "start";

/** Is this first word a consent command? Case and surrounding space are ignored. */
export function consentKeyword(verb: string | undefined): ConsentKeyword | null {
  const w = (verb ?? "").trim().toLowerCase();
  if (STOP_WORDS.includes(w)) return "stop";
  if (START_WORDS.includes(w)) return "start";
  return null;
}

/**
 * Split a contact list into who may be texted and who opted out.
 *
 * Numbers are compared exactly: both sides are E.164 as `msisdnSchema` stores
 * them. The opted-out list is returned, not dropped, so the caller can say how
 * many were not alerted — a count that silently shrank would read as "alerted".
 */
export function partitionByOptOut<T extends { msisdn: string }>(
  contacts: readonly T[],
  optedOut: ReadonlySet<string>,
): { reachable: T[]; optedOut: T[] } {
  const reachable: T[] = [];
  const out: T[] = [];
  for (const c of contacts) (optedOut.has(c.msisdn) ? out : reachable).push(c);
  return { reachable, optedOut: out };
}
