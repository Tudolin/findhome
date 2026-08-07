/**
 * Derived signals: the numbers that decide whether to act on a listing, none of
 * which any portal shows you.
 *
 * Pure functions over data already loaded, so this module is safe on both sides
 * of the client boundary and needs no query of its own.
 */

/** One entry of a listing's price history, as loaded from `property_price_events`. */
export type PricePoint = { totalPrice: number; delta: number; seenAt: Date | string };

export type PriceSignal = {
  /** Total change since the listing was first seen. Negative is a cut. */
  changeSinceFirst: number;
  /** The most recent single move. */
  lastChange: number;
  /** How many times the price has moved at all. */
  moves: number;
  /** The highest price it has been advertised at. */
  peak: number;
  /** Down, up, or never moved. */
  direction: 'down' | 'up' | 'flat';
};

/**
 * Summarises a price history.
 *
 * Ordered oldest-first by the caller; nothing here re-sorts, because doing it in
 * SQL is free and doing it per card is not.
 */
export function priceSignal(history: PricePoint[]): PriceSignal | null {
  if (history.length === 0) return null;

  const first = history[0].totalPrice;
  const last = history[history.length - 1].totalPrice;
  const changeSinceFirst = last - first;
  const moves = history.filter((point, index) => index > 0 && point.delta !== 0).length;

  return {
    changeSinceFirst,
    lastChange: history[history.length - 1].delta,
    moves,
    peak: Math.max(...history.map((point) => point.totalPrice)),
    direction: changeSinceFirst < 0 ? 'down' : changeSinceFirst > 0 ? 'up' : 'flat',
  };
}

/**
 * Days since the listing was first seen.
 *
 * `createdAt` is deliberately preserved across every re-scrape (see the upsert in
 * scraper/src/persist.ts), which is what makes this meaningful — it is the date
 * the ad entered *our* catalogue, not the date it was last touched.
 *
 * Honest caveat: it is days since **we** first saw it, not since the advertiser
 * posted it. A listing that existed for two months before this app was installed
 * reads as new. That gap closes on its own and only matters in the first weeks.
 */
export function daysListed(createdAt: Date | string): number {
  const then = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86_400_000));
}

/**
 * Is this worth mentioning on a card?
 *
 * A threshold, because a R$ 20 move on a R$ 3.000 rent is noise and putting a
 * badge on it trains people to ignore badges. 2% or R$ 100, whichever is larger.
 */
export function isNotablePriceMove(change: number, base: number): boolean {
  if (change === 0) return false;
  return Math.abs(change) >= Math.max(100, base * 0.02);
}

/**
 * "Sitting" — advertised long enough that the price is probably negotiable.
 *
 * 45 days is a rule of thumb, not a measurement: past about six weeks a Brazilian
 * rental ad has been seen by everyone actively looking, and an advertiser who has
 * not let it go is usually the one who moves. Exposed as a constant so it is
 * arguable rather than buried in a comparison.
 */
export const SITTING_DAYS = 45;
