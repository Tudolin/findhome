-- Chase a minimum gallery size instead of visiting each listing exactly once.
--
-- `photos_fetched_at` could only say "visited", so a listing whose lazy carousel
-- failed to finish was stamped with two photos and never reopened. The counter
-- below lets the gallery pass retry under-target listings across runs while
-- still giving up on ads that genuinely have two photos.

ALTER TABLE "properties"
  ADD COLUMN "photo_attempts" INTEGER NOT NULL DEFAULT 0;

-- Everything already visited has had exactly one attempt. Leaving these at 0
-- would hand the whole existing catalogue a fresh budget of retries on the next
-- run, which on a home server is hours of page loads nobody asked for.
UPDATE "properties"
   SET "photo_attempts" = 1
 WHERE "photos_fetched_at" IS NOT NULL;

-- The retry branch filters photos_fetched_at + photo_count + photo_attempts
-- together, so the existing two-column index no longer covers the scan.
DROP INDEX IF EXISTS "properties_photos_fetched_at_photo_count_idx";

CREATE INDEX "properties_photos_fetched_at_photo_count_photo_attempts_idx"
  ON "properties"("photos_fetched_at", "photo_count", "photo_attempts");
