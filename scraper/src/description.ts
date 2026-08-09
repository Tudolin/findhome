/**
 * Choosing a listing's description from what its page offered. Pure, and
 * deliberately dependency-free.
 *
 * Same reasoning as photo-merge.ts: this is a decision with real consequences
 * (it overwrites a column people read), so it is the part most worth testing —
 * and testing it from inside photos.ts would mean constructing a Prisma client
 * and pulling in Playwright to exercise a function that compares string lengths.
 */

/**
 * Shortest string that can plausibly be an advertiser's description.
 *
 * Below this it is a heading, a breadcrumb, or a stray `[class*="description"]`
 * node that happened to match — all of which were observed being written into the
 * column as if they were the ad's own prose.
 */
export const MIN_DESCRIPTION = 60;

/** Matches persist.ts, which is the other writer of this column. */
export const MAX_DESCRIPTION = 4000;

/**
 * Portal furniture rather than this ad's text.
 *
 * `og:description` is the main offender: on a listing page it is very often the
 * site's own marketing line, and it is the field a naive implementation would
 * trust first precisely because it is the easiest to read.
 */
const BOILERPLATE =
  /(encontre o im[oó]vel ideal|an[uú]ncios? gr[aá]tis|o maior portal|cadastre seu im[oó]vel|baixe o aplicativo|todos os direitos reservados|pol[ií]tica de privacidade|aceita(mos)? (cookies|seu)|central de atendimento)/i;

/**
 * Choose the best description found on a listing page, or null to keep what is
 * already stored.
 *
 * Longest wins. That sounds crude and is the right rule here: the competing
 * candidates are overwhelmingly the *same text at different truncations* — a card
 * blurb ending in "…", an `og:description` clipped to 160 characters, and the
 * full prose in ld+json — so length is a direct proxy for completeness.
 *
 * The stored value is only replaced when the new one is meaningfully longer.
 * Without that margin, a page whose description differs by a trailing space would
 * rewrite the row on every visit, and the gallery pass now revisits listings.
 */
export function pickDescription(found: string[], existing: string | null): string | null {
  let best: string | null = null;

  for (const raw of found) {
    // Whitespace collapsed before measuring: portal descriptions are padded with
    // blank lines and ASCII rules, so raw length rewards formatting over content.
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION);
    if (text.length < MIN_DESCRIPTION) continue;
    if (BOILERPLATE.test(text)) continue;
    if (best === null || text.length > best.length) best = text;
  }

  if (best === null) return null;

  const current = existing?.replace(/\s+/g, ' ').trim() ?? '';
  if (current.length === 0) return best;

  // 20 characters: longer than a whitespace or punctuation difference, shorter
  // than a sentence, so a genuinely fuller description still wins.
  return best.length > current.length + 20 ? best : null;
}
