/**
 * The file an upload reference names, or null when it does not name one.
 *
 * `raksha_detections.image_ref` is written by two paths: the citizen report,
 * which stores a key it made itself (`hazards/<id>.<ext>`), and device
 * ingestion, which stores whatever string the edge device sent. The photo read
 * and the reject-and-delete both joined that string onto UPLOAD_DIR as it was,
 * so a device reporting `../../app/.env` had an officer's routine "reject"
 * delete that file, and the photo endpoint serve it. A device credential is
 * exactly the one the threat model treats as capturable.
 *
 * Anything that resolves outside the upload directory - `..` segments, an
 * absolute path, a drive letter - is not an upload, and every caller treats it
 * as "no photo".
 */
import { resolve, sep } from "node:path";

export function uploadPath(root: string, ref: string | null | undefined): string | null {
  if (typeof ref !== "string" || ref === "" || ref.includes("\0")) return null;
  const base = resolve(root);
  const full = resolve(base, ref);
  return full.startsWith(base + sep) ? full : null;
}
