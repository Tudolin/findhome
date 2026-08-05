'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { LOCALES, dictionaryFor, type Locale } from '@/lib/i18n';
import { THEMES, type Theme } from '@/lib/theme';
import { useLocale, useT } from './LocaleProvider';

/**
 * Theme and language, in one small menu.
 *
 * Both are cookies rather than user rows: they are per-device preferences (a
 * phone in a dark room, a shared party account read in two languages) and they
 * have to be readable during server render, which a database lookup on every
 * request would make expensive for no benefit.
 *
 * The theme is applied to <html> immediately on click so the change is instant,
 * and only then persisted — waiting for a round trip to repaint would feel
 * broken. The language does need the round trip, because the strings are chosen
 * during server render.
 */
export default function AppearanceMenu({ theme }: { theme: Theme }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Theme>(theme);
  const [, startTransition] = useTransition();

  function applyTheme(next: Theme) {
    setCurrent(next);

    const resolved =
      next === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : next;
    document.documentElement.setAttribute('data-theme', resolved);

    // Persisted through an API route rather than document.cookie so the flags
    // (path, SameSite, one-year Max-Age) live in one place on the server.
    void fetch('/api/appearance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: next }),
    });
  }

  async function applyLocale(next: Locale) {
    if (next === locale) return setOpen(false);
    await fetch('/api/appearance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: next }),
    });
    setOpen(false);
    // Every string is chosen on the server, so the tree has to be re-rendered.
    startTransition(() => router.refresh());
  }

  const themeIcon: Record<Theme, string> = { light: '☀', dark: '☾', system: '◐' };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${t.theme.toggle} / ${t.language.toggle}`}
        title={`${t.theme.label} · ${t.language.label}`}
        className={clsx('btn-ghost !gap-1.5 !px-3 !py-2', open && 'shadow-neu-inset-sm')}
      >
        <span aria-hidden className="text-base leading-none">
          {themeIcon[current]}
        </span>
        <span className="text-[11px] font-bold">{dictionaryFor(locale).locale.short}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-52 rounded-2xl bg-surface p-2 shadow-neu-lg">
            <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-500">{t.theme.label}</p>
            <div className="space-y-1">
              {THEMES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => applyTheme(option)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-all duration-150',
                    option === current
                      ? 'bg-surface text-brand-700 shadow-neu-inset-sm'
                      : 'bg-surface text-ink-700 shadow-neu-sm hover:text-ink-900',
                  )}
                >
                  <span aria-hidden>{themeIcon[option]}</span>
                  {t.theme[option]}
                  {option === current && <span className="ml-auto text-brand-600">✓</span>}
                </button>
              ))}
            </div>

            <p className="mt-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-500">
              {t.language.label}
            </p>
            <div className="space-y-1">
              {LOCALES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => void applyLocale(option)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-all duration-150',
                    option === locale
                      ? 'bg-surface text-brand-700 shadow-neu-inset-sm'
                      : 'bg-surface text-ink-700 shadow-neu-sm hover:text-ink-900',
                  )}
                >
                  <span aria-hidden className="text-[11px] font-bold">
                    {dictionaryFor(option).locale.short}
                  </span>
                  {dictionaryFor(option).locale.name}
                  {option === locale && <span className="ml-auto text-brand-600">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
