'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { money } from '@/lib/format';
import { useT } from './LocaleProvider';

export type ShareableListing = {
  id: string;
  title: string;
  neighborhood: string;
  city: string;
  totalPrice: number;
  bedrooms: number;
  sqm: number;
  /** The portal's own ad — what the other person will actually want to open. */
  sourceUrl: string;
};

/**
 * Copies a shortlist as text.
 *
 * Not a share *link*. A public list page would need a token, a route, an
 * expiry and a decision about what a stranger may see — and the way this
 * actually gets shared is a WhatsApp message to one person, which is text. So the
 * button produces the message.
 *
 * Each entry carries the **portal URL**, not a FindHome one: the person receiving
 * it does not have an account here, and a link to `/property/…` is a login wall.
 * The FindHome link goes at the bottom once, for the people who do.
 */
export default function ShareList({
  listings,
  heading,
  appUrl,
  className,
  label,
}: {
  listings: ShareableListing[];
  /** First line of the message, e.g. "Meus 4 favoritos em Curitiba". */
  heading: string;
  /** Optional link back to the filtered view, for people who have an account. */
  appUrl?: string;
  className?: string;
  label?: string;
}) {
  const t = useT();
  const [done, setDone] = useState(false);

  function compose(): string {
    const lines = listings.map((listing, index) => {
      const specs = [listing.bedrooms ? `${listing.bedrooms}q` : null, listing.sqm ? `${listing.sqm}m²` : null]
        .filter(Boolean)
        .join(' · ');

      return [
        `${index + 1}. *${money(listing.totalPrice)}*${specs ? ` — ${specs}` : ''}`,
        `${listing.neighborhood}, ${listing.city}`,
        listing.sourceUrl,
      ].join('\n');
    });

    // `*bold*` is WhatsApp's markup and degrades to literal asterisks anywhere
    // else, which is a fair trade for the one place this is actually pasted.
    return [heading, '', lines.join('\n\n'), appUrl ? `\n${t.share.seeInApp} ${appUrl}` : '']
      .filter(Boolean)
      .join('\n');
  }

  async function copy() {
    const payload = compose();

    // The native sheet first — it is what puts WhatsApp at the top of the list.
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: heading, text: payload });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setDone(true);
        window.setTimeout(() => setDone(false), 2000);
        return;
      }
    } catch {
      // Insecure context — fall through to the old API below.
    }

    // Plain http:// on a LAN reaches neither modern API. See ShareButton.
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

  if (listings.length === 0) return null;

  return (
    <button
      type="button"
      onClick={copy}
      className={clsx(className ?? 'btn-ghost', done && 'text-brand-700')}
      aria-live="polite"
    >
      <span aria-hidden>{done ? '✓' : '📋'}</span>
      {done ? t.share.copied : (label ?? t.share.shareList(listings.length))}
    </button>
  );
}
