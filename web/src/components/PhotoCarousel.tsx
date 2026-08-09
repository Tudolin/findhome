'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import Lightbox from './Lightbox';
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
  /** Index being shown full-screen, or null. */
  const [viewer, setViewer] = useState<number | null>(null);

  const count = images.length;
  const gesture = useRef<{ x: number; y: number; axis: 'none' | 'x' | 'y' } | null>(null);

  // Arrow-key navigation — the carousel is the main way to judge a listing.
  // Suspended while the viewer is open: it owns the keyboard then, and both
  // handlers firing would advance two photos per press.
  useEffect(() => {
    if (count < 2 || viewer !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + count) % count);
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, viewer]);

  /**
   * Swipe on the inline carousel.
   *
   * Same axis-lock rule as the viewer: a drag that starts mostly vertical is left
   * to the page, one that starts mostly horizontal changes the photo. Without the
   * lock, trying to scroll past the gallery flips through it instead — which is
   * how a carousel becomes something people scroll around rather than through.
   */
  const SWIPE = 50;

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    gesture.current = { x: touch.clientX, y: touch.clientY, axis: 'none' };
  }

  function onTouchMove(event: React.TouchEvent) {
    const start = gesture.current;
    if (!start || count < 2) return;
    const dx = event.touches[0].clientX - start.x;
    const dy = event.touches[0].clientY - start.y;
    if (start.axis === 'none' && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
  }

  function onTouchEnd(event: React.TouchEvent) {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.axis !== 'x') return;

    const dx = event.changedTouches[0].clientX - start.x;
    if (Math.abs(dx) <= SWIPE) return;

    // A committed horizontal swipe must not also count as a tap on the button,
    // or every swipe would open the full-screen viewer.
    event.preventDefault();
    setIndex((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
  }

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
        {/**
         * Fixed aspect box, PLUS an absolute maximum height.
         *
         * `aspect-[4/3]` alone derives height from width, which is fine — until a
         * portrait photo on a narrow phone makes that box taller than the screen
         * and the gallery becomes a scroll trap. `max-h-[65vh]` caps it, and the
         * `contain` fit means capping the height simply letterboxes rather than
         * cropping anything.
         *
         * `overflow-hidden` and the global `img { min-width: 0 }` in globals.css
         * are what stop a 4000px photo widening the page — see the note there.
         */}
        <div className="relative aspect-[4/3] max-h-[65vh] w-full overflow-hidden rounded-xl bg-surface-sunken shadow-neu-inset-sm">
          {/* A button, not a div: opening the viewer is an action, and it has to
              be reachable by keyboard and announced as clickable. `zoom-in` is the
              only affordance a photo gets, so it matters. */}
          <button
            type="button"
            onClick={() => setViewer(index)}
            aria-label={t.photos.open}
            className="absolute inset-0 h-full w-full cursor-zoom-in"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* object-CONTAIN, not cover.
                `cover` crops whatever does not fit, which on a portrait photo of a
                room reads as an arbitrary zoom into the middle of it — the
                listing's own framing is lost. `contain` shows the whole frame and
                letterboxes the remainder against the sunken surface.

                ListingImage, not <img>: the OLX CDN 403s any request carrying our
                Referer — see the note in ListingImage.tsx. */}
            <ListingImage
              src={images[index]}
              alt={`${alt} — ${index + 1}`}
              eager
              fallback={t.card.noPhoto}
              className="h-full w-full object-contain"
            />
          </button>

          {count > 1 && (
            <>
              {/* Hidden on a phone, where the swipe is the gesture and two
                  floating buttons just cover the photo. */}
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t.photos.previous}
                className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-lg font-bold text-ink-700 shadow-neu-sm backdrop-blur transition-all hover:text-ink-900 active:shadow-neu-inset-sm sm:flex"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t.photos.next}
                className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-lg font-bold text-ink-700 shadow-neu-sm backdrop-blur transition-all hover:text-ink-900 active:shadow-neu-inset-sm sm:flex"
              >
                ›
              </button>
              <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-surface/90 px-3 py-1 text-[11px] font-bold text-ink-700 shadow-neu-sm backdrop-blur">
                {index + 1} / {count}
              </span>
              {/* Told once, on the device where it is not obvious. */}
              <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-surface/90 px-3 py-1 text-[11px] font-semibold text-ink-500 shadow-neu-sm backdrop-blur sm:hidden">
                {t.photos.swipeHint}
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
              aria-label={t.photos.show(i + 1)}
              aria-current={i === index}
              // First click selects, second opens. A thumbnail that jumped
              // straight to full-screen would make simply *browsing* the strip
              // impossible — you could never look at one without being taken
              // somewhere.
              onClick={() => (i === index ? setViewer(i) : setIndex(i))}
              ref={(node) => {
                // Keep the active thumbnail visible when the photo changes by
                // swipe or arrow key, or the strip and the photo disagree.
                if (i === index) node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              }}
              className={clsx(
                'h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-surface p-1 transition-all duration-150 ease-neu',
                i === index
                  ? 'cursor-zoom-in shadow-neu-inset-sm ring-1 ring-brand-400'
                  : 'shadow-neu-sm hover:opacity-80',
              )}
            >
              <ListingImage src={src} alt="" fallback="" className="h-full w-full rounded-lg object-cover" />
            </button>
          ))}
        </div>
      )}

      {viewer !== null && (
        <Lightbox
          images={images}
          alt={alt}
          startIndex={viewer}
          // The inline carousel follows the viewer, so closing leaves you on the
          // photo you were actually looking at rather than snapping back to where
          // you opened it.
          onClose={(finalIndex) => {
            setIndex(finalIndex);
            setViewer(null);
          }}
        />
      )}
    </div>
  );
}
