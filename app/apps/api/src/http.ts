/**
 * The two things every route module needs and neither should redefine.
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
