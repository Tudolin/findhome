/**
 * Canonical Brazilian location vocabulary.
 *
 * Every place name that enters the system — typed by a user, returned by a
 * portal — is reduced to a `locationSlug` before it is stored or compared.
 * That is what makes "São Paulo", "Sao Paulo", "SAO PAULO" and "são  paulo"
 * one city instead of four, and it is why the feed filter can be an exact
 * equality check instead of a fragile case-insensitive LIKE.
 *
 * ⚠️ THIS FILE IS DUPLICATED VERBATIM AT web/src/lib/locations.ts.
 * The scraper and the web app are separate npm packages with separate tsconfig
 * roots, so there is no import path between them. Keep the two copies identical
 * below this header. `locationSlug` is ALSO reimplemented in SQL inside
 * prisma/migrations/20260805000000_location_normalization/migration.sql — the
 * three implementations must agree or backfilled rows will not match new ones.
 */

export type BrazilState = {
  /** Two-letter federative unit code, uppercase. The canonical stored form. */
  uf: string;
  /** Full name as the portals spell it, accents included. */
  name: string;
};

export const BR_STATES: BrazilState[] = [
  { uf: 'AC', name: 'Acre' },
  { uf: 'AL', name: 'Alagoas' },
  { uf: 'AP', name: 'Amapá' },
  { uf: 'AM', name: 'Amazonas' },
  { uf: 'BA', name: 'Bahia' },
  { uf: 'CE', name: 'Ceará' },
  { uf: 'DF', name: 'Distrito Federal' },
  { uf: 'ES', name: 'Espírito Santo' },
  { uf: 'GO', name: 'Goiás' },
  { uf: 'MA', name: 'Maranhão' },
  { uf: 'MT', name: 'Mato Grosso' },
  { uf: 'MS', name: 'Mato Grosso do Sul' },
  { uf: 'MG', name: 'Minas Gerais' },
  { uf: 'PA', name: 'Pará' },
  { uf: 'PB', name: 'Paraíba' },
  { uf: 'PR', name: 'Paraná' },
  { uf: 'PE', name: 'Pernambuco' },
  { uf: 'PI', name: 'Piauí' },
  { uf: 'RJ', name: 'Rio de Janeiro' },
  { uf: 'RN', name: 'Rio Grande do Norte' },
  { uf: 'RS', name: 'Rio Grande do Sul' },
  { uf: 'RO', name: 'Rondônia' },
  { uf: 'RR', name: 'Roraima' },
  { uf: 'SC', name: 'Santa Catarina' },
  { uf: 'SP', name: 'São Paulo' },
  { uf: 'SE', name: 'Sergipe' },
  { uf: 'TO', name: 'Tocantins' },
];

/**
 * Unicode combining diacritical marks. Built from escapes rather than written
 * as a literal character class: a bare combining-mark range renders as
 * invisible glyphs and does not survive every editor or encoding round-trip.
 */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * "São Paulo" -> "sao-paulo", "  Vila   Mariana " -> "vila-mariana".
 *
 * NFD splits an accented character into its base letter plus a combining mark;
 * dropping U+0300-U+036F therefore folds every Portuguese diacritic, including
 * the cedilla in "ç", down to ASCII.
 */
export function locationSlug(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Collapses whitespace and trims, without touching accents or case. */
export function displayName(value: string | null | undefined, max = 120): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * "São Paulo" -> "Sao Paulo": folds accents but keeps spacing and case.
 * Grupo ZAP's location ids are built from unaccented display names
 * ("BR>Parana>NULL>Curitiba"), which is neither a slug nor the raw name.
 */
export function asciiName(value: string | null | undefined): string {
  return displayName(value).normalize('NFD').replace(COMBINING_MARKS, '');
}

const BY_UF = new Map(BR_STATES.map((s) => [s.uf, s]));
const BY_SLUG = new Map(BR_STATES.map((s) => [locationSlug(s.name), s]));

/**
 * Accepts anything a portal or a user might supply for a state — "SP", "sp",
 * "São Paulo", "sao paulo" — and returns the canonical UF, or null when it is
 * not a Brazilian state.
 */
export function toUf(value: string | null | undefined): string | null {
  const raw = displayName(value);
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (BY_UF.has(upper)) return upper;

  return BY_SLUG.get(locationSlug(raw))?.uf ?? null;
}

/** "PR" -> "Paraná". Returns null for anything that is not a known UF. */
export function ufToStateName(value: string | null | undefined): string | null {
  const uf = toUf(value);
  return uf ? (BY_UF.get(uf)?.name ?? null) : null;
}

/**
 * Normalises a user-entered neighborhood list: drops blanks, folds duplicates
 * that differ only by accent or case, and keeps the first spelling seen as the
 * display form.
 */
export function dedupeBySlug(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const display = displayName(value, 80);
    const slug = locationSlug(display);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(display);
  }
  return out;
}
