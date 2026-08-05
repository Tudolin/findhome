import { en, type Dict } from './en';
import { pt } from './pt';

/**
 * Translation, without a dependency.
 *
 * The app has two locales and a few hundred strings, so a hand-rolled dictionary
 * is smaller, faster and easier to audit than next-intl or i18next — and it adds
 * nothing to the image. `Dict` is derived from en.ts, so every locale is
 * type-checked and a missing key breaks the build instead of rendering blank.
 *
 * ⚠️ This module must stay free of `next/headers`. It is imported by client
 * components (LocaleProvider, AppearanceMenu), and importing a server-only API
 * anywhere in that graph fails the build with "You're importing a component that
 * needs next/headers". The request-scoped helpers live in ./server instead.
 */

export const LOCALE_COOKIE = 'fh_locale';

export const LOCALES = ['pt', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Portuguese: this is a Brazilian-market tool used by a Brazilian household. */
export const DEFAULT_LOCALE: Locale = 'pt';

const DICTIONARIES: Record<Locale, Dict> = { en, pt };

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'pt' || value === 'en';
}

export function dictionaryFor(locale: Locale): Dict {
  return DICTIONARIES[locale];
}

/** HTML lang attribute for a locale. */
export const HTML_LANG: Record<Locale, string> = { pt: 'pt-BR', en: 'en' };

export type { Dict };
