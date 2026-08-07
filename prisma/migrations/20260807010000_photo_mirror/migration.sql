-- Local photo mirror + "this ad was taken down" bookkeeping.
--
-- Two related problems, one migration:
--
--  1. Portal photo URLs expire, and OLX's CDN refuses any request whose Referer
--     is not olx.com.br. A shortlist looked at two months later is a wall of grey
--     placeholders. `property_photos` is the index for locally mirrored copies —
--     the scraper can send the portal's own Referer because it fetches
--     server-side, which the browser cannot.
--
--  2. Listings disappear. `active` already went false when one stopped showing up
--     in search results, but there was no record of the ad being *taken down*,
--     and nothing ever deleted the rows or reclaimed their disk.
--
-- `properties.images` is untouched and stays canonical: it is still the ordered
-- list of portal URLs, and everything works with this table empty.

-- AlterTable: why a listing went inactive, not just that it did.
ALTER TABLE "properties" ADD COLUMN "gone_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "property_photos" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "remote_url" VARCHAR(700) NOT NULL,
    "path" VARCHAR(120),
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "content_type" VARCHAR(60),
    "fetched_at" TIMESTAMP(3),
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_photos_property_id_remote_url_key"
  ON "property_photos"("property_id", "remote_url");

-- CreateIndex
CREATE INDEX "property_photos_property_id_position_idx"
  ON "property_photos"("property_id", "position");

-- CreateIndex: orphan-file pruning joins on this.
CREATE INDEX "property_photos_path_idx" ON "property_photos"("path");

-- CreateIndex: drives the mirror queue — "no local copy, not given up on".
CREATE INDEX "property_photos_path_fail_count_idx" ON "property_photos"("path", "fail_count");

-- AddForeignKey
ALTER TABLE "property_photos" ADD CONSTRAINT "property_photos_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the index from the URLs already stored, so the first mirror run has a
-- queue to work through instead of waiting for every listing to be re-scraped.
--
-- `WITH ORDINALITY` carries the array position across, which is what keeps the
-- mirror in the portal's own order. The query string is stripped here for the
-- same reason the scraper strips it (see photoKey): these CDNs decorate one file
-- with per-request parameters, and comparing full URLs would store the same photo
-- several times.
INSERT INTO "property_photos" ("id", "property_id", "position", "remote_url")
SELECT
  -- Deterministic id, so re-running this statement collides with the unique
  -- index instead of inserting duplicates.
  md5(p.id || '|' || split_part(split_part(u.url, '#', 1), '?', 1)),
  p.id,
  (u.ord - 1)::int,
  left(split_part(split_part(u.url, '#', 1), '?', 1), 700)
FROM "properties" p, unnest(p."images") WITH ORDINALITY AS u(url, ord)
WHERE u.url LIKE 'http%'
ON CONFLICT ("property_id", "remote_url") DO NOTHING;
