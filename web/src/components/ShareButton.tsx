'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { useT } from './LocaleProvider';

/**
 * Share, with the phone's own sheet when there is one.
 *
 * `navigator.share` is what puts WhatsApp at the top of the list, which is where
 * a Brazilian household actually sends a flat. It only exists on mobile browsers
 * and only over HTTPS, so the clipboard is the fallback — and `document.execCommand`
 * behind that, because `navigator.clipboard` is also HTTPS-only and this app is
 * routinely reached over `http://192.168.x.x`.
 *
 * The three-step ladder is the whole point: on a LAN with no TLS, both modern
 * APIs are absent, and a share button that silently does nothing is worse than no
 * button.
 */
export default function ShareButton({
  url,
  title,
  text,
  className,
  label,
  compact = false,
}: {
  url: string;
  title?: string;
  /** Prefixed to the URL when copying, so a pasted link arrives with context. */
  text?: string;
  className?: string;
  label?: string;
  compact?: boolean;
}) {
  const t = useT();
  const [done, setDone] = useState(false);

  async function share() {
    const payload = text ? `${text}\n${url}` : url;

    // 1. The native sheet.
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title, text, url });
        return;
      } catch (err) {
        // AbortError is the user closing the sheet — not a failure, and falling
        // through to "copied!" after they deliberately cancelled would be wrong.
        if ((err as Error)?.name === 'AbortError') return;
      }
    }

    // 2. The async clipboard, where the page is secure.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setDone(true);
        window.setTimeout(() => setDone(false), 2000);
        return;
      }
    } catch {
      // Permission denied or an insecure context — fall through.
    }

    // 3. The old way. Deprecated, still the only thing that works on plain http.
    const scratch = document.createElement('textarea');
    scratch.value = payload;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    try {
      document.execCommand('copy');
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } finally {
      document.body.removeChild(scratch);
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className={clsx(className ?? 'btn-ghost', done && 'text-brand-700')}
      aria-live="polite"
    >
      <span aria-hidden>{done ? '✓' : '🔗'}</span>
      {!compact && <span>{done ? t.share.copied : (label ?? t.share.share)}</span>}
    </button>
  );
}
