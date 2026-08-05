-- Upgrade already-stored photo URLs to the large variants.
--
-- The parsers now request the big size, but rows scraped before that keep their
-- thumbnail URL until the listing happens to be re-scraped — which for an
-- inactive listing is never. Rewriting them here means the improvement shows up
-- as soon as this migration runs.
--
-- Every substitution was measured against the live CDN on the same file:
--
--   QuintoAndar   /img/med/          450x300     3 kB  ->  /img/xxl/     1152x768   14 kB
--   OLX           /thumbs700x500/    667x500    40 kB  ->  /images/      1280x960  143 kB
--   ImovelWeb     /360x266/          360x266    19 kB  ->  /1200x1200/  1179x824  140 kB
--   Chaves na Mão /imn/0340X0250/    340x250     4 kB  ->  /imn/1600X1200/ 1600x1024 27 kB
--
-- Idempotent: re-running matches nothing, because the patterns only appear in
-- the old form. `regexp_replace` per element via unnest, re-aggregated in the
-- original order.

UPDATE "properties" AS p
SET "images" = COALESCE(rewritten.images, p."images")
FROM (
  SELECT
    src.id,
    array_agg(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(url, '/img/med/', '/img/xxl/'),
            '/thumbs[0-9]+x[0-9]+/', '/images/'
          ),
          '/imn/[0-9]+X[0-9]+/', '/imn/1600X1200/'
        ),
        '^(https://imgbr\.imovelwebcdn\.com/.*)/[0-9]+x[0-9]+/', '\1/1200x1200/'
      )
      ORDER BY ord
    ) AS images
  FROM (
    SELECT id, url, ord
    FROM "properties", unnest("images") WITH ORDINALITY AS u(url, ord)
  ) AS src
  GROUP BY src.id
) AS rewritten
WHERE p.id = rewritten.id
  AND p."images" <> rewritten.images;
