import { z } from 'zod';
import { NextResponse } from 'next/server';
import { handler } from '@/lib/http';
import { LOCALE_COOKIE, LOCALES } from '@/lib/i18n';
import { THEME_COOKIE, THEMES } from '@/lib/theme';

export const dynamic = 'force-dynamic';

/**
 * Persists the per-device theme and language.
 *
 * Deliberately does NOT require a sign-in: the login screen needs the language
 * switch too, and neither value reveals or changes anything about an account.
 * Both cookies are readable by script (the theme bootstrap in <head> reads the
 * theme before React exists) so httpOnly would break the feature.
 */
const schema = z
  .object({
    theme: z.enum(THEMES).optional(),
    locale: z.enum(LOCALES).optional(),
  })
  .refine((v) => v.theme !== undefined || v.locale !== undefined, {
    message: 'Send at least one of theme or locale',
  });

const ONE_YEAR = 60 * 60 * 24 * 365;

export const POST = handler(async (req: Request) => {
  const { theme, locale } = schema.parse(await req.json());

  const response = NextResponse.json({ theme: theme ?? null, locale: locale ?? null });
  const options = { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' as const, httpOnly: false };

  if (theme) response.cookies.set(THEME_COOKIE, theme, options);
  if (locale) response.cookies.set(LOCALE_COOKIE, locale, options);

  return response;
});
