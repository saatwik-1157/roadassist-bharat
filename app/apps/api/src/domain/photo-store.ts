/**
 * Where a citizen's hazard-report photo is kept, and how big it may be
 * (ADR-0013, amending the "only a reference in the database" rule).
 *
 *   disk  UPLOAD_DIR/hazards/<id>.<ext>; image_ref holds that key. Right for a
 *         developer's machine and for any host with a persistent volume.
 *   db    the raksha_photos table; image_ref holds `db:hazards/<id>.<ext>`.
 *         Right for the hosted demo, whose free-plan disk is wiped on every
 *         redeploy and which has no object-storage account.
 *
 * Pure, so the choice and the cap are unit-tested without a server (the same
 * shape as geoServicesEnabled in domain/geo.ts).
 */
import { isLocalEnv } from "./local-env.js";

export type PhotoStore = "disk" | "db";

/**
 * The most the database store accepts for one photo: 600 KiB, 614400 bytes.
 *
 * Both clients shrink a photo first (longest side 1280 px, JPEG quality 0.8).
 * Measured through apps/web/photo-shrink.js: a 4000x3000 road frame came out at
 * 106 KB, and 4000x3000 pure noise, JPEG's worst case, at 415 KB. So the cap
 * refuses nothing an up-to-date client sends, while stopping an old client's
 * full-resolution 3-5 MB camera file from landing in a free-tier database.
 * Its base64 form (819200 characters) also fits under Fastify's default 1 MiB
 * body limit, which a larger cap would not. migrate.ts carries the same number
 * as a CHECK.
 */
export const DB_PHOTO_MAX_BYTES = 600 * 1024;

/** image_ref's prefix for a photo held in raksha_photos. */
export const DB_REF_PREFIX = "db:";

/**
 * PHOTO_STORE, or the default for this NODE_ENV when it is unset.
 *
 * Unset means disk on a developer's own machine or a test run (development,
 * test, ci - the same allow-list as every other local-only default) and db
 * everywhere else, demo and production included. The allow-list makes an
 * unexpected NODE_ENV land on the durable side.
 *
 * A value that is neither is refused rather than guessed at: PHOTO_STORE=database
 * silently falling back to an ephemeral disk is exactly the loss this exists
 * to stop, so the server does not start.
 */
export function photoStoreFor(setting: string | undefined, nodeEnv: string | undefined): PhotoStore {
  const s = (setting ?? "").trim().toLowerCase();
  if (s === "disk" || s === "db") return s;
  if (s !== "") {
    throw new Error(
      `PHOTO_STORE="${setting}" is not a photo store. Set it to disk or db, or leave it unset ` +
      "(disk under NODE_ENV development/test/ci, db otherwise).",
    );
  }
  return isLocalEnv(nodeEnv) ? "disk" : "db";
}

/** The byte ceiling for one photo: UPLOAD_MAX_BYTES, and never more than the db cap on the db store. */
export function photoByteCap(store: PhotoStore, uploadMaxBytes: number): number {
  return store === "db" ? Math.min(uploadMaxBytes, DB_PHOTO_MAX_BYTES) : uploadMaxBytes;
}

/** Whether a decoded photo of `bytes` bytes may be stored. Exactly the cap is allowed. */
export function photoSizeVerdict(bytes: number, cap: number): "ok" | "photo_empty" | "photo_too_large" {
  if (!(bytes > 0)) return "photo_empty";
  return bytes > cap ? "photo_too_large" : "ok";
}

/** "600 KB", "4 MB": the cap as the person refused by it reads it. */
export function describeCap(cap: number): string {
  return cap >= 1_000_000 ? `${Math.round(cap / 1e6)} MB` : `${Math.round(cap / 1024)} KB`;
}

/** Whether image_ref names a photo in raksha_photos (rather than a file on disk). */
export function isDbPhotoRef(ref: string | null | undefined): boolean {
  return typeof ref === "string" && ref.startsWith(DB_REF_PREFIX);
}
