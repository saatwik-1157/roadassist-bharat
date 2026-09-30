# ADR-0013 — Hazard-report photos may live in the database, capped, until there is object storage

**Status:** Accepted · 2026-09-30 · Owner: platform
**Amends:** the "photos never enter the database, only a reference" rule
attributed to [ADR-0006](0006-ai-rules-first.md)

## Context

A citizen's hazard report can carry a photo (`POST /v1/raksha/report`). Until
now the API wrote it to `UPLOAD_DIR` and kept only the file key in
`raksha_detections.image_ref`. The code and several documents cite ADR-0006 for
that rule: `env.ts`, `raksha.ts`, `server.ts`, `app/README.md`, `VIVA.md`,
`SWE4004-MAPPING.md` and the root `DEPLOYMENT.md`. **ADR-0006's text does not
say it.** ADR-0006 records that every AI capability ships rules-first behind a
stable contract. The nearest thing it has is model governance: inference is
journaled by hash (`model_predictions.input_hash`), never with its input. The
photo rule grew out of that and was never written down as a decision of its
own. This ADR writes it down, and amends it.

The hosted demo is one Render web service on the free plan over a Neon
Postgres database. Render's free plan has no persistent disk: `UPLOAD_DIR` is
wiped on every restart and every redeploy. So **every hazard photo was lost at
the next deploy**, and the photo endpoint answered 404 for a report whose row
said it had one. The documents said so honestly ("photos ephemeral"). Making
the disk durable needs a paid Render instance. Object storage needs an account
with a provider (S3, R2, GCS, Azure Blob), and the project has none. The demo
is also built to need no third-party accounts; the basemap proxy and ADR-0012's
location services are keyless for the same reason.

The database is the one durable store the demo already has.

## Decision

Photos go to one of two stores, chosen by `PHOTO_STORE=disk|db`
(`apps/api/src/domain/photo-store.ts`, `photoStoreFor`):

- **Unset:** `disk` under `NODE_ENV` development, test and ci, and `db`
  everywhere else, demo and production included. This uses the same allow-list
  as every other local-only default (`domain/local-env.ts`), so an unexpected
  `NODE_ENV` gets the durable store. Any other value stops the server at boot.
  `PHOTO_STORE=database` must not quietly fall back to the disk that loses
  photos.
- **`db`:** the bytes go in a new table, `raksha_photos` (migration
  `0008_raksha_photos`). It has one row per detection and holds `detection_id`,
  `mime` and `bytes bytea`, plus the universal columns. `image_ref` becomes
  `db:hazards/<id>.<ext>`.
- **`disk`:** unchanged. The file goes under `UPLOAD_DIR/hazards/`, and every
  disk read still goes through `domain/upload-path.ts`.
- **Reads** (`GET /v1/raksha/detections/:id/photo`) serve from whichever store
  holds that photo, whatever `PHOTO_STORE` says today. The owner-or-authority
  check runs first, as before. A `db:` ref is looked up by the detection's own
  id, never by the ref's text. A device that sends `db:...` as its `image_ref`
  therefore reaches nobody's photo.
- **Reject** deletes the row with a real `DELETE`, not a soft delete. The point
  of rejecting is to stop holding the bytes. For a disk photo, reject deletes
  the file, as before.

### The cap: 600 KiB (614,400 bytes) per photo on the db store

The API refuses a larger photo with **413 `photo_too_large`**, and the response
includes `maxBytes`. A `CHECK (octet_length(bytes) BETWEEN 1 AND 614400)` in
`migrate.ts` backs it up for any other write path. A unit test fails if the two
numbers drift apart. The disk store keeps `UPLOAD_MAX_BYTES` (4 MB) as its cap.

Why 600 KiB:

- **The clients never come close.** Both clients shrink a photo before sending
  it. The web app uses `apps/web/photo-shrink.js`: longest side 1280 px, JPEG
  quality 0.8, then smaller or lower-quality steps only if the result still
  does not fit. The Android app uses `processReportImage` in `MainActivity.kt`,
  with the same ladder. Measured in Chromium through `photo-shrink.js`: a
  4000×3000 camera-sized JPEG of a road frame (4.39 MB) came out at 1280×960 and
  **106 KB**. A 4000×3000 image of pure RGB noise, the worst case for JPEG
  (12.2 MB), came out at **415 KB**. The cap sits above the worst case we could
  construct. It is there to stop a full-resolution 3–5 MB camera file from an
  old client, not to refuse an ordinary photo.
- **It fits the request limit that already exists.** Fastify's default body
  limit is 1 MiB, and the API does not raise it. The base64 form of 600 KiB is
  819,200 characters, which fits with the rest of the report. A cap above
  about 780 KB could never be reached: Fastify would refuse the body with its
  own generic 413 first. The same limit already made the old 4 MB disk cap
  unreachable. A photo over about 780 KB failed on the body limit, not on
  `UPLOAD_MAX_BYTES`.
- **It keeps a free Neon database healthy.** Neon's free plan allows 0.5 GB of
  storage and 5 GB of public network transfer per project per month (neon.com/
  pricing, read 2026-09-30; these figures have changed before, so check them
  again). A fully seeded local database is 34 MB (`pg_database_size`, after
  migrate, seed and seed:raksha). The hosted database's own size was not
  measured for this ADR. On the local figure, about 465 MB is left. That is
  about **750 photos at the cap**, or about **4,300 at the 106 KB measured
  above**. Each view of a photo is egress from Neon to Render. The
  route sends `cache-control: private, max-age=3600`, so a browser does not
  fetch the same photo twice within an hour. The per-user report limit (20 per
  hour) bounds how fast any one account can spend this.

## Consequences

- **Photos survive a redeploy on the hosted demo.** This applies from the first
  deploy that includes migration 0008. Photos uploaded before that were on the
  ephemeral disk and are gone. Nothing recovers them. The authority dashboard
  already says "Photo no longer on this server" for them. The citizen's own
  list shows the report without the photo rather than showing a broken image.
- **The database grows with photos.** Photos are now most of the data by
  bytes. `pg_dump` backups (`scripts/backup.sh`, custom format) grow by roughly
  the same amount, because JPEG does not compress further. Restore time grows
  with them, and the RTO in `app/docs/DEPLOYMENT.md` was measured without
  photos. `bytes` is `STORAGE EXTERNAL`, so Postgres stores the bytes out of
  line and does not try pglz on data that is already compressed.
- **The free-tier quota becomes a limit on the product.** At about 750–4,300
  photos the demo database reaches its storage cap and every write fails, not
  only photo writes. That is acceptable for a demo that sees a few reports a
  day. It is not acceptable for a service. Nothing deletes old photos
  automatically: only rejection does.
- **Serving a photo takes a database connection.** It is one indexed lookup,
  but it is one more per photo view. The disk store took none.
- **Object storage in an Indian region remains the production answer.** For
  example S3 `ap-south-1` (Mumbai) or an equivalent. There, `image_ref` holds an
  object key, the bytes never touch Postgres, and the service can issue
  short-lived signed URLs, so the API does not stream the bytes itself. That
  also meets the "no PII leaves India" constraint, which the Singapore demo
  does not meet (`app/docs/SUBMISSION.md`). When it arrives it is a third
  value of `PHOTO_STORE`, and this ADR's `db` store becomes the fallback for a
  deployment with no bucket.
