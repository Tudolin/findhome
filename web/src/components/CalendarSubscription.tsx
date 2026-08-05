'use client';

import { useState } from 'react';
import { useT } from './LocaleProvider';

/**
 * The subscribe-from-your-calendar panel.
 *
 * The URL contains a bearer token, so it is treated like a secret: shown on
 * demand, copyable in one click, and rotatable. The warning about what the link
 * grants is not boilerplate — anyone holding it can read this user's viewing
 * schedule, and that is worth saying next to the button rather than in a doc.
 */
export default function CalendarSubscription({ https, webcal }: { https: string; webcal: string }) {
  const t = useT();
  const [url, setUrl] = useState({ https, webcal });
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url.https);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard needs a secure context; over plain http on a LAN it is often
      // unavailable, and the input below is selectable as a fallback.
    }
  }

  async function rotate() {
    if (!window.confirm(t.visits.rotateConfirm)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rotate: true }),
      });
      const data = (await res.json()) as { https?: string; webcal?: string };
      if (data.https && data.webcal) setUrl({ https: data.https, webcal: data.webcal });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold">{t.visits.subscribe}</h2>
      <p className="mt-1 text-xs text-ink-500">{t.visits.subscribeHelp}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          readOnly
          value={url.https}
          onFocus={(e) => e.currentTarget.select()}
          className="input !py-2 font-mono !text-xs"
          aria-label={t.visits.subscribe}
        />
        <button type="button" onClick={copy} className="btn-ghost !py-2 shrink-0">
          {copied ? t.visits.copied : t.visits.copy}
        </button>
        <a href={url.webcal} className="btn-primary !py-2 shrink-0">
          webcal://
        </a>
      </div>

      <p className="mt-3 text-[11px] text-ink-400">{t.visits.rotateHelp}</p>
      <button type="button" onClick={rotate} disabled={busy} className="btn-ghost mt-2 !py-2 !text-xs">
        {t.visits.rotate}
      </button>
    </div>
  );
}
