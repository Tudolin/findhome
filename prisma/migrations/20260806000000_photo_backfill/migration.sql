-- Gallery backfill bookkeeping.
--
-- Half the portals publish exactly one photo in their search results:
--
--   ZAP / Viva Real   listing.images[]        full gallery      ✔
--   QuintoAndar       coverImage + imageList  full gallery      ✔
--   OLX               card <img>              cover only        ✘
--   Chaves na Mão     schema.org item.image   cover only        ✘
--   ImovelWeb         card <img>              cover, carousel lazy-loaded  ✘
--
-- The rest of the gallery only exists on the listing's own page, so there is a
-- second pass that opens it (scraper/src/photos.ts). These two columns are its
-- bookkeeping, and the distinction between them matters:
--
--   photos_fetched_at NULL  ->  never asked; a candidate for the next run
--   photos_fetched_at set   ->  asked. photo_count says what came back, so a
--                               listing whose page genuinely has one photo is
--                               not re-fetched forever.

ALTER TABLE "properties" ADD COLUMN "photos_fetched_at" TIMESTAMP(3);
ALTER TABLE "properties" ADD COLUMN "photo_count" INTEGER NOT NULL DEFAULT 0;

-- Seeded from what is already stored, so listings that arrived with a full
-- gallery (ZAP, Viva Real, QuintoAndar) are not queued behind the ones that need
-- the pass. photos_fetched_at stays NULL: the count is a fact about the data we
-- have, not a claim that the listing's own page was ever opened.
UPDATE "properties" SET "photo_count" = cardinality("images") WHERE "images" IS NOT NULL;

-- Drives the backfill's "needs photos, never tried" scan. Partial indexes cannot
-- be expressed in schema.prisma and would read as permanent drift, so this is a
-- plain composite one — and it earns its keep: the pass runs on every scrape and
-- the alternative is a sequential scan of the whole catalogue each time.
CREATE INDEX "properties_photos_fetched_at_photo_count_idx"
  ON "properties"("photos_fetched_at", "photo_count");
