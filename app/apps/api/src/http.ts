/**
 * The few wire-level things every route module needs and none should redefine.
 *
 * `server.ts` grew to 3,000 lines with 49 routes, and the first step of pulling
 * route groups out of it is giving them somewhere shared to import from. These
 * are deliberately the ONLY things here: a file called `shared` accumulates
 * whatever is convenient, and then every module depends on every other one
 * through it. If something is needed by two route groups and is about the
 * domain rather than the wire, it belongs in `domain/`.
 */
import { z } from "zod";

/**
 * The response envelope. Every successful reply in this API is `{ data, meta }`
 * — `data` is the thing, `meta` is everything about the thing, and a client can
 * tell them apart without knowing the endpoint.
 */
export const ok = <T>(data: T, meta: Record<string, unknown> = {}) => ({ data, meta });

/**
 * An Indian mobile number in E.164.
 *
 * Shared rather than repeated because it is used on three unrelated paths —
 * sign-in, emergency contacts, and the inbound telecom webhook — and those must
 * agree on what a phone number is. `[6-9]` is the first digit of every mobile
 * series TRAI has allocated; landlines and short codes are not valid accounts.
 */
export const msisdnSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, "Enter a valid Indian mobile number");

/**
 * A timestamp as the ISO 8601 string every typed response already carries.
 *
 * Wire format, so it lives here: three route groups return raw rows, and they
 * must agree on what a time looks like.
 *
 * Drizzle's typed selects map timestamp columns to Date, which JSON renders as
 * ISO. A raw `db.execute(sql…)` does not: drizzle registers pass-through
 * parsers for the date types, so the row holds Postgres's own text —
 * "2026-09-25 08:26:43.59901+00". That is not ISO (a space for the "T", an
 * hour-only offset, microseconds), and only V8's lenient legacy parser accepts
 * it. The mechanic console turned the space into a "T" to be helpful, which
 * made it invalid everywhere, and every job in History read "Invalid Date".
 * Converting where the text leaves the database fixes every client at once
 * instead of teaching each page Postgres's format.
 *
 * Accepts a Date, an ISO string, or Postgres text with or without a zone (a
 * zoneless value is UTC, as drizzle reads it). null/undefined become null.
 * Anything unparseable is returned unchanged rather than dropped or guessed
 * at, so a surprise shows up in the response instead of vanishing.
 */
const PG_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2}){0,2})?$/i;

export function isoTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const text = String(value).trim();
  const m = PG_TIMESTAMP.exec(text);
  if (!m) return text;
  const [, date, time, fraction = "", zone] = m;
  // Date parsing is only specified to milliseconds; Postgres keeps microseconds.
  const ms = fraction ? "." + fraction.slice(0, 3).padEnd(3, "0") : "";
  let offset = "Z";
  if (zone && zone.toUpperCase() !== "Z") {
    // "+00", "+0530" and "+05:30" all normalise to ±HH:MM. Postgres prints
    // seconds only for pre-1900 local-mean-time offsets, which no row here has.
    const digits = zone.slice(1).replace(/:/g, "");
    offset = `${zone[0]}${digits.slice(0, 2)}:${digits.slice(2, 4) || "00"}`;
  }
  const seconds = time.length === 5 ? `${time}:00` : time;
  const parsed = new Date(`${date}T${seconds}${ms}${offset}`);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

/** `isoTimestamp` applied to the named columns of a raw row; every other column is untouched. */
export function withIsoTimestamps<T extends Record<string, unknown>>(
  row: T, columns: readonly string[],
): T {
  const out: Record<string, unknown> = { ...row };
  for (const column of columns) if (column in out) out[column] = isoTimestamp(out[column]);
  return out as T;
}
