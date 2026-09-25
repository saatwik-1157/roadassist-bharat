-- Additive and nullable: existing rows and the running API are unaffected until
-- the new review code reads it. IF NOT EXISTS so a database that had the column
-- applied by hand ahead of the migrator does not fail here.
ALTER TABLE "mechanics" ADD COLUMN IF NOT EXISTS "rating_baseline" double precision;--> statement-breakpoint
-- Backfill: a mechanic nobody has reviewed yet is carrying a rating from before
-- the platform (onboarding, or the seed standing in for it), and that is the
-- baseline their first review must fold into. A mechanic who already has
-- reviews was rated by the old rule, which shrank toward the platform mean; a
-- NULL baseline means exactly that prior, so their stored rating stays
-- reproducible from their review rows. Re-running this changes nothing.
UPDATE "mechanics" m
   SET "rating_baseline" = m."rating"
 WHERE m."rating_baseline" IS NULL
   AND m."rating" BETWEEN 1 AND 5
   AND NOT EXISTS (
     SELECT 1 FROM "reviews" r
      WHERE r."mechanic_id" = m."id" AND r."deleted_at" IS NULL
   );
