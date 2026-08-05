'use client';

import { createContext, useContext } from 'react';
import { dictionaryFor, DEFAULT_LOCALE, type Dict, type Locale } from '@/lib/i18n';

/**
 * Makes the request's dictionary available to client components.
 *
 * The provider is seeded by the server layout with the locale it already
 * resolved from the cookie, so the first client render uses exactly the strings
 * the server sent — no flash of English, no hydration mismatch. Only the locale
 * *name* crosses the boundary, not the dictionary: both bundles already contain
 * both dictionaries, so shipping the object would just duplicate it in the RSC
 * payload.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export default function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** The active dictionary. Named `useT` because every call site reads `t.x.y`. */
export function useT(): Dict {
  return dictionaryFor(useContext(LocaleContext));
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}
