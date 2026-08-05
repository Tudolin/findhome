'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import ListingImage from './ListingImage';
import { useT } from './LocaleProvider';

export default function PhotoCarousel({ images, alt }: { images: string[]; alt: string }) {
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

  if (count === 0) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-2xl bg-surface text-sm text-ink-400 shadow-neu-inset">
        {t.card.noPhoto}
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
