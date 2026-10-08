/**
 * What RAKSHA accepts from an edge device and from a dashboard query, and how
 * one model sighting is recognised when it arrives a second time.
 *
 * Pure, so every rule is unit-tested without a server or a database
 * (test/raksha-input.test.ts), the same shape as domain/upload-path.ts.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

// ── capturedAt ──────────────────────────────────────────────────────────────
// `z.coerce.date()` took null (the epoch), true (1 ms after it) and year 9999,
// so a broken device clock wrote a pothole into 1970 or into the far future,
// where every "last 30 days" window misses it for ever. A device must send an
// ISO 8601 instant with its offset, inside a window a real queue can produce.

/** A device clock a few minutes fast is ordinary drift; further is not. */
export const CAPTURED_AT_MAX_FUTURE_MS = 5 * 60_000;
/** An offline queue a month old is the oldest a road condition is still news. */
export const CAPTURED_AT_MAX_AGE_MS = 30 * 24 * 3600_000;

export type CapturedAtVerdict = "ok" | "in_future" | "too_old";

export function capturedAtVerdict(at: Date, now: Date = new Date()): CapturedAtVerdict {
  const delta = at.getTime() - now.getTime();
  if (delta > CAPTURED_AT_MAX_FUTURE_MS) return "in_future";
  if (-delta > CAPTURED_AT_MAX_AGE_MS) return "too_old";
  return "ok";
}

/** An ISO datetime WITH an offset ("Z" or "+05:30"), parsed to a Date in the window above. */
export const capturedAtSchema = z.string()
  .datetime({ offset: true, message: "capturedAt must be an ISO 8601 datetime with an offset, e.g. 2026-10-07T09:30:00+05:30" })
  .transform((s) => new Date(s))
  .superRefine((at, ctx) => {
    const v = capturedAtVerdict(at);
    if (v === "in_future") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "capturedAt is more than 5 minutes in the future — check the device clock" });
    } else if (v === "too_old") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "capturedAt is more than 30 days old" });
    }
  });

// ── boolean query parameters ────────────────────────────────────────────────
// `z.coerce.boolean()` is Boolean(value), and every non-empty string is true:
// `?overdueOnly=false` returned only the overdue rows. A query string carries
// text, so the text is read.
export const queryBoolean = z.enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

// ── one sighting, whichever device sends it ─────────────────────────────────
/**
 * The content key of a model detection, stored in raksha_detections.source_key
 * under a unique index (migration 0009).
 *
 * The op id is a device's own idempotency key, unique per (device, op id), so
 * the same detection sent by a second device - the simulator's --from-json run
 * replaying what the boot seed already ingested, or a rejected detection
 * replayed by another credential - came back as new rows and new incidents.
 * This key is what the sighting IS, independent of who sends it:
 *
 *   · with an imageRef, the frame: the model, the frame, and the detection's
 *     class, confidence and severity. Position and capture time are left out
 *     on purpose - for a dataset frame they are assigned per upload (RDD2022
 *     carries no GPS), so they differ between two uploads of one detection.
 *   · without one, the reading itself: model, class, confidence, severity,
 *     position and capture instant. Two devices cannot produce all of that to
 *     the millisecond by chance; only a replay does.
 *
 * Citizen reports are not model detections and carry no key (NULL), which the
 * unique index allows any number of.
 */
export interface SourceKeyInput {
  modelVersion: string;
  type: string;
  confidence: number;
  severity: number;
  lat: number;
  lng: number;
  capturedAt: Date;
  imageRef?: string | null;
}

export function detectionSourceKey(d: SourceKeyInput): string {
  const parts = d.imageRef
    ? ["frame", d.modelVersion, d.imageRef, d.type, d.confidence, d.severity]
    : ["reading", d.modelVersion, d.type, d.confidence, d.severity, d.lat, d.lng, d.capturedAt.toISOString()];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

// ── whose photo a reference names ───────────────────────────────────────────
/**
 * True only when `ref` is the key the server itself wrote for THIS detection:
 * `hazards/<detectionId>.<jpg|png|webp>`, with or without the database store's
 * `db:` prefix.
 *
 * upload-path.ts keeps a device's image_ref inside UPLOAD_DIR, but inside it a
 * device could still name another report's photo, `hazards/<their id>.jpg`:
 * the photo route served that citizen's picture under the device's detection,
 * and rejecting the device's detection deleted it. A device's image_ref names a
 * frame on the device, never a file on this server, so only the server-written
 * key is ever read from disk or unlinked.
 */
export function isOwnPhotoKey(ref: string | null | undefined, detectionId: string): boolean {
  if (typeof ref !== "string") return false;
  const key = ref.startsWith("db:") ? ref.slice(3) : ref;
  return key === `hazards/${detectionId}.jpg` || key === `hazards/${detectionId}.png` ||
    key === `hazards/${detectionId}.webp`;
}
