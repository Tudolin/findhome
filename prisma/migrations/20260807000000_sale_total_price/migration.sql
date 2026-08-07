-- `total_price` meant one thing for rentals and the wrong thing for sales.
--
-- It is the column the feed filters and sorts on, and it was always written as
-- rent + condo + IPTU/12. For a rental that is correct and useful: one monthly
-- number, what actually leaves the account. For a sale it is nonsense — a
-- R$ 650.000 flat with a R$ 900 condo fee and R$ 300/month of IPTU was stored at
-- R$ 651.200, so:
--
--   * a "up to R$ 650.000" search did not match it,
--   * the card showed R$ 651.200 "/mês",
--   * and sorting by price interleaved sales with their own running costs.
--
-- From now on `total_price` is the asking price alone for SALE (see normalize()
-- in scraper/src/persist.ts). This backfills the rows already stored.
--
-- condo_fee and tax_fee are deliberately NOT cleared: you go on paying them after
-- buying, and the detail screen shows them. They are just no longer part of the
-- number you search by.
--
-- Idempotent: re-running matches nothing, because the WHERE clause only finds
-- rows whose total still disagrees with the rent price.

UPDATE "properties"
SET "total_price" = "rent_price"
WHERE "listing_type" = 'SALE'
  AND "total_price" <> "rent_price";

-- Same story for the search targets people already saved. A profile switched to
-- Buy kept a rent-scale ceiling (the old preferences slider capped at R$ 20.000),
-- which after this migration filters out every sale listing in the country rather
-- than a few. Clearing the ceiling is the honest repair: "no maximum" shows
-- everything and the user can set a real one, whereas guessing a number for them
-- would silently hide listings.
--
-- Only ceilings that are implausible for a sale are touched — a profile that
-- already had a sensible one (say R$ 800.000) is left exactly as it is.
UPDATE "preference_profiles"
SET "max_price" = NULL,
    "min_price" = NULL
WHERE "listing_type" = 'SALE'
  AND "max_price" IS NOT NULL
  AND "max_price" <= 100000;

-- `include_condo_in_max_price` is a rent-only idea (it chooses between comparing
-- the budget against bare rent or against rent + fees). On a sale profile there
-- is nothing to include, and leaving it true made the app's own description of
-- the filter read "up to R$ 800.000 all-in", which is wrong.
UPDATE "preference_profiles"
SET "include_condo_in_max_price" = false
WHERE "listing_type" = 'SALE';
