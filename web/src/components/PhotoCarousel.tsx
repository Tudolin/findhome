'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import ListingImage from './ListingImage';
import { useT } from './LocaleProvider';

export default function PhotoCarousel({
  images,
  alt,
  /** The ad is closed. Changes what an empty gallery *means*. */
  archived = false,
  /** Photos that existed while the ad was live and are no longer retrievable. */
  missing = 0,
}: {
  images: string[];
  alt: string;
  archived?: boolean;
  missing?: number;
}) {
  const t = useT();
  const [index, setIndex] = useState(0);

  const count = images.length;

  // Arrow-key navigation — the carousel is the main way to judge a listing.
  useEffect(() => {
    if (count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + count) % count);
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count]);

  /**
   * Nothing to show.
   *
   * Two different situations wearing the same empty box, and conflating them is a
   * real loss of information: a live listing whose portal published no photo is
   * "no photo", while a closed ad whose twelve photos are gone is "these existed
   * and are no longer retrievable". The second deserves the count.
   */
  if (count === 0) {
    return (
      <div className="card flex aspect-[4/3] flex-col items-center justify-center gap-2 p-8 text-center">
        <span aria-hidden className="text-3xl opacity-40">
          {archived ? '🗄️' : '🏚️'}
        </span>
        <p className="text-sm font-bold text-ink-600">{archived ? t.card.archivedNoPhotos : t.card.noPhoto}</p>
        {archived && missing > 0 && <p className="text-xs text-ink-400">{t.card.photosLost(missing)}</p>}
      </div>
    );
  }

  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  return (
    <div>
      <div className="card p-3">
        {/* Taller than 16:10: listing photos are often portrait, and a wide box
            plus object-contain would letterbox them down to a stamp. */}
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-surface-sunken shadow-neu-inset-sm">
          {/* object-CONTAIN, not cover.
              `cover` crops whatever does not fit the 16:10 box, which on a
              portrait photo of a room reads as an arbitrary zoom into the middle
              of it — the listing's own framing is lost. `contain` shows the whole
              frame and letterboxes the remainder against the sunken surface.

              ListingImage, not <img>: the OLX CDN 403s any request carrying our
              Referer — see the note in ListingImage.tsx. */}
          <ListingImage
            src={images[index]}
            alt={`${alt} — ${index + 1}`}
            eager
            fallback={t.card.noPhoto}
            className="h-full w-full object-contain"
          />

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-lg font-bold text-ink-700 shadow-neu-sm backdrop-blur transition-all hover:text-ink-900 active:shadow-neu-inset-sm"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-lg font-bold text-ink-700 shadow-neu-sm backdrop-blur transition-all hover:text-ink-900 active:shadow-neu-inset-sm"
              >
                ›
              </button>
              <span className="absolute bottom-3 right-3 rounded-full bg-surface/90 px-3 py-1 text-[11px] font-bold text-ink-700 shadow-neu-sm backdrop-blur">
                {index + 1} / {count}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Said out loud rather than letting a one-photo archive look like a
          one-photo listing. This is the note that explains why a flat you
          remember having a dozen photos now has one. */}
      {archived && missing > 0 && (
        <p className="mt-2 text-center text-xs text-ink-400">{t.card.photosLost(missing)}</p>
      )}

      {count > 1 && (
        <div className="scrollbar-thin mt-3 flex gap-2.5 overflow-x-auto px-1 pb-2">
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={clsx(
                'h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-surface p-1 transition-all duration-150 ease-neu',
                i === index ? 'shadow-neu-inset-sm' : 'shadow-neu-sm hover:opacity-80',
              )}
            >
              <ListingImage src={src} alt="" fallback="" className="h-full w-full rounded-lg object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
