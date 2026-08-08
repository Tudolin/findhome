-- Rent and purchase stop overwriting each other.
--
-- `listing_type` was the only switch and it shared ONE budget, so flipping to Buy
-- rewrote the rent ceiling and flipping back rewrote the purchase one. Two
-- searches whose numbers are three orders of magnitude apart cannot share a
-- column — a household weighing "buy or keep renting" was losing whichever one it
-- was not looking at.
--
-- `min_price` / `max_price` keep their names and their meaning (rent per month),
-- because every value already in them is a rent value. The purchase budget gets
-- its own pair, and `listing_type` now only chooses which one is showing.

ALTER TABLE "preference_profiles" ADD COLUMN "sale_min_price" INTEGER;
ALTER TABLE "preference_profiles" ADD COLUMN "sale_max_price" INTEGER;

-- Profiles already on Buy have a purchase budget sitting in the rent columns.
-- Move it across, then clear the rent side rather than leaving a purchase number
-- there to be applied as a monthly rent the moment somebody switches.
--
-- 20260807000000 already nulled implausible sale ceilings (<= 100k), so anything
-- surviving here is a real purchase figure.
UPDATE "preference_profiles"
SET "sale_min_price" = "min_price",
    "sale_max_price" = "max_price",
    "min_price" = NULL,
    "max_price" = NULL
WHERE "listing_type" = 'SALE';
