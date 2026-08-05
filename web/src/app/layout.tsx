import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import LocaleProvider from '@/components/LocaleProvider';
import { HTML_LANG } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { isTheme, THEME_BOOTSTRAP, THEME_COOKIE } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'FindHome',
  description: 'Self-hosted real estate search aggregator with collaborative Party Mode.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Two entries so mobile browser chrome matches whichever skin is showing.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef3e8' },
    { media: '(prefers-color-scheme: dark)', color: '#252b22' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const stored = (await cookies()).get(THEME_COOKIE)?.value;

  // An explicit light/dark choice is rendered server-side so the correct palette
  // is in the very first byte. "system" (and no cookie at all) cannot be
  // resolved here — there is no request header for prefers-color-scheme — so it
  // is left to THEME_BOOTSTRAP, which runs before paint.
  const theme = isTheme(stored) && stored !== 'system' ? stored : undefined;

  return (
    <html lang={HTML_LANG[locale]} data-theme={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
