/**
 * What a listing actually costs to move into.
 *
 * The advertised price is never the number that leaves your account, and the gap
 * is much bigger for a purchase than most people expect: on a R$ 650.000 flat the
 * taxes and fees are around R$ 30.000, none of which appears on any portal.
 *
 * ## These are defaults, not facts
 *
 * ITBI is a **municipal** tax and the rate genuinely differs by city — 2% in São
 * Paulo, 3% in a lot of places, and some municipalities discount a first
 * purchase or a financed one. Registry fees follow a state table that steps by
 * property value rather than scaling smoothly. So every rate here is
 * configurable, the output is labelled as an estimate, and the app never
 * presents it as the bill.
 *
 * Getting this roughly right and saying so is far more useful than not showing it
 * at all, which is the status quo everywhere else.
 */

const pct = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed / 100 : fallback;
};

/**
 * Plain env vars, not `NEXT_PUBLIC_*`.
 *
 * Next inlines `NEXT_PUBLIC_` at **build** time, so a value set in
 * docker-compose would be ignored and the built-in default used instead —
 * silently, which is the worst way for a tax rate to be wrong. These are read at
 * runtime, which means this module is server-only; every caller is a server
 * component, and it must stay that way.
 */
export const COST_RATES = {
  /** Imposto de Transmissão de Bens Imóveis. Municipal; 2–3% is the usual band. */
  itbi: pct(process.env.ITBI_PCT, 0.03),
  /** Escritura pública — waived when the purchase is financed (the contract serves). */
  deed: pct(process.env.DEED_PCT, 0.01),
  /** Registro de imóveis. */
  registry: pct(process.env.REGISTRY_PCT, 0.008),
};

export type EntryCost = {
  price: number;
  itbi: number;
  deed: number;
  registry: number;
  /** Taxes and fees only, without the price. */
  fees: number;
  /** Price + fees. */
  total: number;
  /** Fees as a share of the asking price, for the "≈ 4,8% a mais" line. */
  feesPct: number;
};

/**
 * Up-front cost of a purchase.
 *
 * `financed` drops the deed fee: a financed purchase is registered from the bank
 * contract, which serves as the public instrument, so there is no separate
 * escritura to pay for. That is a real several-thousand-reais difference and the
 * kind of thing worth modelling rather than averaging away.
 */
export function entryCost(price: number, options: { financed?: boolean } = {}): EntryCost {
  const itbi = Math.round(price * COST_RATES.itbi);
  const deed = options.financed ? 0 : Math.round(price * COST_RATES.deed);
  const registry = Math.round(price * COST_RATES.registry);
  const fees = itbi + deed + registry;

  return {
    price,
    itbi,
    deed,
    registry,
    fees,
    total: price + fees,
    feesPct: price > 0 ? fees / price : 0,
  };
}

/**
 * Up-front cash for a rental.
 *
 * Far more variable than a purchase — it depends entirely on the guarantee the
 * landlord accepts — so this returns a *range* rather than a number, and the UI
 * presents it as one:
 *
 *   caução        commonly 3 months' rent
 *   seguro fiança often 1–2 months' rent as an annual premium
 *   fiador        free, if you have one
 *
 * The first month is included in every case because it is always due.
 */
export function rentalUpfront(rent: number, condo: number): { min: number; max: number } {
  const firstMonth = rent + condo;
  return {
    // A guarantor costs nothing beyond the first month.
    min: firstMonth,
    // Three months' deposit is the common ceiling, and the legal maximum for a
    // caução under the Lei do Inquilinato.
    max: firstMonth + rent * 3,
  };
}
