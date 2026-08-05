'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { runScrape } from '@/lib/client';

/**
 * "Scrape now" button.
 *
 * Kicking a run off is fast (the scraper answers 202 and works in the
 * background) but the run itself takes minutes, so this polls until the
 * scheduler reports idle and then refreshes the feed. Polling stops on unmount
 * and after a hard cap, because a hung scraper should not leave a browser tab
 * hammering the API for the rest of the day.
 */

const POLL_MS = 4000;
const MAX_POLLS = 150; // ~10 minutes

export default function ScrapeTrigger({ initialRunning = false }: { initialRunning?: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(initialRunning);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const polls = useRef(0);

  useEffect(() => {
    if (!running) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;

      if (polls.current++ > MAX_POLLS) {
        setRunning(false);
        setError('Still running after 10 minutes — check `docker compose logs scraper`.');
        return;
      }

      try {
        const res = await fetch('/api/scrape', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { scheduler?: { running?: boolean } };
        if (data.scheduler?.running === false) {
          setRunning(false);
          startTransition(() => router.refresh());
        }
      } catch {
        // A transient network blip should not end the poll; the cap will.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, router]);

  async function trigger() {
    setError(null);
    polls.current = 0;
    try {
      await runScrape();
      setRunning(true);
    } catch (err) {
      const message = (err as Error).message;
      // The scraper reports an in-progress run as a conflict; that is not a
      // failure, it just means someone (or cron) got there first.
      if (/already in progress/i.test(message)) setRunning(true);
      else setError(message);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={trigger}
        disabled={running}
        title="Run every enabled source now, without waiting for the schedule"
        className={clsx(
          'rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-150 ease-neu',
          running ? 'pressed-on cursor-progress' : 'pressed-off',
        )}
      >
        {running ? 'Scraping…' : 'Scrape now'}
      </button>
      {running && <span className="text-[11px] text-ink-500">this can take a few minutes</span>}
      {error && <span className="chip tint-con !text-[10px]">{error}</span>}
    </div>
  );
}
