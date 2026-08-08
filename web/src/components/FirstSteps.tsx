'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useT } from './LocaleProvider';
import { IconClose } from './Icons';

export type Step = {
  key: string;
  title: string;
  body: string;
  href?: string;
  action?: string;
  done: boolean;
};

/**
 * The "what do I do now" panel, for the first week.
 *
 * A feed of two hundred flats with no explanation is not obviously a tool for
 * *deciding* — most people treat it as another listings site, never rate
 * anything, and never find the half of the app that makes it worth self-hosting.
 * This says what to do next, in order, and gets out of the way.
 *
 * ## Why it disappears on its own
 *
 * Every step is derived from real state — a rating exists, a party exists — so
 * the panel empties itself as the app gets used and then stops rendering
 * entirely. Nothing to dismiss, nothing to remember, no "onboarding complete"
 * flag to get out of step with reality.
 *
 * The dismiss button is still there for the person who wants it gone today; that
 * choice is per-device in localStorage, because it is a preference about a panel,
 * not a fact about the account.
 */
export default function FirstSteps({ steps, storageKey = 'fh_first_steps' }: { steps: Step[]; storageKey?: string }) {
  const t = useT();
  const [hidden, setHidden] = useState(true);

  // Read after mount: localStorage does not exist on the server, and the panel
  // starts hidden so it never flashes in for somebody who dismissed it.
  useEffect(() => {
    setHidden(window.localStorage.getItem(storageKey) === '1');
  }, [storageKey]);

  const remaining = steps.filter((step) => !step.done);
  if (hidden || remaining.length === 0) return null;

  const doneCount = steps.length - remaining.length;

  return (
    <section className="card card-p mb-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-ink-800">{t.guide.firstStepsTitle}</h2>
          <p className="mt-1 text-xs text-ink-500">{t.guide.firstStepsProgress(doneCount, steps.length)}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem(storageKey, '1');
            setHidden(true);
          }}
          aria-label={t.guide.dismiss}
          title={t.guide.dismiss}
          className="rounded-lg p-1.5 text-ink-400 shadow-neu-sm hover:text-ink-700"
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>

      {/* A progress bar, because "2 of 5" is a fact and a bar is a feeling. */}
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-500"
          style={{ width: `${Math.max(4, (doneCount / steps.length) * 100)}%` }}
        />
      </div>

      <ol className="space-y-2">
        {steps.map((step) => (
          <li
            key={step.key}
            className={clsx(
              'flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5',
              step.done ? 'opacity-50' : 'shadow-neu-inset-sm',
            )}
          >
            <span
              aria-hidden
              className={clsx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black',
                step.done ? 'bg-brand-400 text-brand-950' : 'text-ink-400 shadow-neu-sm',
              )}
            >
              {step.done ? '✓' : ''}
            </span>

            <span className="min-w-0 flex-1">
              <span className={clsx('block text-sm font-semibold', step.done && 'line-through')}>{step.title}</span>
              {!step.done && <span className="block text-xs text-ink-500">{step.body}</span>}
            </span>

            {!step.done && step.href && (
              <Link href={step.href} className="btn-ghost !py-1.5 !text-xs">
                {step.action ?? t.guide.go}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
