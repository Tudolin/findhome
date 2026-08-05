'use client';

import { useState } from 'react';
import clsx from 'clsx';

/**
 * A remote listing photo.
 *
 * `referrerPolicy="no-referrer"` is the entire reason this component exists.
 * OLX's image CDN refuses any request whose Referer is not olx.com.br — measured
 * against img.olx.com.br with the same URL:
 *
 *   no Referer                        -> 200 image/webp
 *   Referer: https://www.olx.com.br/  -> 200 image/webp
 *   Referer: http://<this app>/...    -> 403
 *
 * So every OLX photo rendered as a broken image while being stored perfectly
 * well. Sending no Referer fixes it and costs nothing on the other portals'
 * CDNs, which do not check. Centralising it here means a future `<img>` added by
 * hand cannot quietly reintroduce the bug.
 *
 * Deliberately not next/image: these URLs are remote, unoptimized (see
 * next.config.mjs) and hotlink-protected, so the Image runtime buys nothing —
 * and its proxy would strip the referrer policy anyway.
 */
export default function ListingImage({
  src,
  alt,
  className,
  eager = false,
  fallback = 'No photo',
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  eager?: boolean;
  fallback?: string;
}) {
  const [failed, setFailed] = useState(false);

  // Portals expire their photo URLs, so a listing that was fine last week can
  // come back with a dead image. A quiet placeholder beats a broken-image icon.
  if (!src || failed) {
    return (
      <div className={clsx('flex items-center justify-center bg-surface-sunken text-xs text-ink-400', className)}>
        {fallback}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
