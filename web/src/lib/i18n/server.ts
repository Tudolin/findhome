import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Dict, type Locale } from './index';

/**
 * Request-scoped locale helpers.
 *
 * Split out from ./index because these touch `next/headers`, which cannot appear
 * anywhere in a client component's import graph — and ./index is imported by
 * LocaleProvider precisely so the client can look up the same dictionary.
 */

/** The locale for this request, from the cookie set by the appearance menu. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Convenience for server components: the dictionary for this request. */
export async function getDictionary(): Promise<Dict> {
  return dictionaryFor(await getLocale());
}
