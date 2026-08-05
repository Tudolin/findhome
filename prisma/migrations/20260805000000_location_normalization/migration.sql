-- Location normalisation.
--
-- Adds the accent- and case-folded slug columns that city/state/neighborhood
-- filtering now runs on, plus a state on preference profiles so the scraper
-- stops assuming SCRAPE_DEFAULT_STATE for every city.
--
-- The slug expression below is the SQL twin of `locationSlug()` in
-- scraper/src/locations.ts and web/src/lib/locations.ts. All three must agree,
-- or rows backfilled here will not match rows written later:
--
--   'São Paulo'    -> 'sao-paulo'
--   'Vila  Mariana'-> 'vila-mariana'
--   'Água Branca'  -> 'agua-branca'
--
-- `translate()` is used rather than `unaccent()` so no extension is required on
-- a stock postgres:16-alpine image.

-- AlterTable
ALTER TABLE "preference_profiles"
  ADD COLUMN "state" VARCHAR(2),
  ADD COLUMN "city_slug" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "neighborhood_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "properties"
  ADD COLUMN "city_slug" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "neighborhood_slug" TEXT NOT NULL DEFAULT '';

-- Backfill: properties.
UPDATE "properties"
SET
  "city_slug" = COALESCE(NULLIF(trim(both '-' from regexp_replace(
    lower(translate("city",
      'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝý',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOooooo' || 'UUUUuuuuCcNnYy')),
    '[^a-z0-9]+', '-', 'g')), ''), ''),
  "neighborhood_slug" = COALESCE(NULLIF(trim(both '-' from regexp_replace(
    lower(translate("neighborhood",
      'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝý',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOooooo' || 'UUUUuuuuCcNnYy')),
    '[^a-z0-9]+', '-', 'g')), ''), '');

-- Backfill: preference profiles. `neighborhood_slugs` is rebuilt element-wise.
UPDATE "preference_profiles"
SET
  "city_slug" = COALESCE(NULLIF(trim(both '-' from regexp_replace(
    lower(translate("city",
      'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝý',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOooooo' || 'UUUUuuuuCcNnYy')),
    '[^a-z0-9]+', '-', 'g')), ''), ''),
  "neighborhood_slugs" = COALESCE((
    SELECT array_agg(DISTINCT slug)
    FROM (
      SELECT trim(both '-' from regexp_replace(
        lower(translate(n,
          'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝý',
          'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOooooo' || 'UUUUuuuuCcNnYy')),
        '[^a-z0-9]+', '-', 'g')) AS slug
      FROM unnest("preference_profiles"."neighborhoods") AS n
    ) slugs
    WHERE slug <> ''
  ), ARRAY[]::TEXT[]);

-- The state column is intentionally left NULL: the scraper falls back to
-- SCRAPE_DEFAULT_STATE, and guessing a state per city here would be worse than
-- the explicit default. Users set it on their next visit to Preferences.

-- Truncate any state that is not already a UF, so the column can hold the
-- canonical two-letter form. Full names are re-derived on the next scrape.
UPDATE "properties" SET "state" = NULL WHERE "state" IS NOT NULL AND length("state") <> 2;
ALTER TABLE "properties" ALTER COLUMN "state" TYPE VARCHAR(2);

-- DropIndex / CreateIndex: the feed now filters on the slug pair.
DROP INDEX IF EXISTS "properties_city_neighborhood_idx";
CREATE INDEX "properties_city_slug_neighborhood_slug_idx" ON "properties"("city_slug", "neighborhood_slug");
