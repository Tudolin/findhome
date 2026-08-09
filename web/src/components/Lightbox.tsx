'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ListingImage from './ListingImage';
import { useT } from './LocaleProvider';
import { IconClose } from './Icons';

/**
 * Full-screen photo viewer.
 *
 * The carousel on the listing page is a 4:3 box a few hundred pixels wide, which
 * is enough to decide whether to keep scrolling and not enough to judge a room.
 * Portal photos are routinely 1600px+; this is where that resolution finally gets
 * used.
 *
 * ## What it has to get right on a phone
 *
 * Swipe, because arrows are a desktop idea and a thumb expects to drag. The
 * gesture is tracked manually rather than through a carousel library: the whole
 * behaviour is forty lines, and it has to coexist with vertical page scrolling,
 * which most libraries handle by hijacking both axes.
 *
 * The axis lock below is the detail that makes it feel right — a drag that starts
 * mostly vertical is left alone so the page scrolls, and one that starts mostly
 * horizontal claims the gesture and never scrolls the page underneath.
 */
export default function Lightbox({
  images,
  alt,
  startIndex,
  onClose,
}: {
  images: string[];
  alt: string;
  startIndex: number;
  /**
   * Receives the photo the viewer was left on.
   *
   * The index lives here, not in the parent, so the parent has no way to know
   * where you ended up — and closing onto a different photo than the one you were
   * looking at reads as the app losing your place. Handing it back is the fix.
   */
  onClose: (index: number) => void;
}) {
  const t = useT();
  const [index, setIndex] = useState(startIndex);
  /** Live finger offset, in px. Drives the drag-follows-thumb transform. */
  const [drag, setDrag] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; axis: 'none' | 'x' | 'y' } | null>(null);

  /**
   * The current index, readable from the key handler without re-subscribing.
   *
   * The listener is registered once, so closing it on `index` would capture the
   * value from the first render and Escape would always report photo 1. Adding
   * `index` to the effect's dependencies would fix that by tearing down and
   * re-adding a window listener on every single photo change; a ref is the
   * cheaper half of that trade.
   */
  const indexRef = useRef(startIndex);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const count = images.length;
  const go = useCallback(
    (delta: number) => setIndex((i) => (i + delta + count) % count),
    [count],
  );

  // --- Keyboard, scroll lock, focus ----------------------------------------
  useEffect(() => {
    const panel = panelRef.current;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose(indexRef.current);
      if (event.key === 'ArrowLeft') return go(-1);
      if (event.key === 'ArrowRight') return go(1);

      // Tab is trapped. The dialog claims `aria-modal`, and a promise that
      // nothing outside exists has to be true or a keyboard user walks out of it
      // into a page they cannot see.
      if (event.key !== 'Tab' || !panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel?.focus();

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [go, onClose]);

  /**
   * The neighbours, fetched while you look at the current one.
   *
   * Without this, every swipe is a blank frame followed by a pop — these are
   * full-resolution photos off a third-party CDN, not thumbnails. Two hidden
   * `<img>` tags is the entire mechanism.
   */
  const neighbours = count > 1 ? [images[(index + 1) % count], images[(index - 1 + count) % count]] : [];

  // --- Touch ---------------------------------------------------------------
  /** Below this, a drag is a tap. Above it, the photo changes. */
  const THRESHOLD = 60;
  /** Movement needed before the gesture commits to an axis. */
  const AXIS_LOCK = 10;

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    gesture.current = { x: touch.clientX, y: touch.clientY, axis: 'none' };
  }

  function onTouchMove(event: React.TouchEvent) {
    const start = gesture.current;
    if (!start || count < 2) return;

    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (start.axis === 'none') {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      // Whichever axis moved more wins, and keeps winning for this gesture.
      start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }

    if (start.axis === 'y') return; // Let the page have it.
    setDrag(dx);
  }

  function onTouchEnd() {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.axis !== 'x') return setDrag(0);

    if (Math.abs(drag) > THRESHOLD) go(drag < 0 ? 1 : -1);
    setDrag(0);
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      tabIndex={-1}
      // `bg-black`, not a palette colour: the ink scale is inverted in dark mode
      // (see globals.css), and a photo viewer wants a neutral surround anyway.
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 outline-none"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white/80">
        <span className="text-sm font-bold tabular-nums">
          {index + 1} / {count}
        </span>
        <button
          type="button"
          onClick={() => onClose(index)}
          aria-label={t.common.close}
          className="rounded-xl p-2 transition-colors hover:bg-white/10 hover:text-white"
        >
          <IconClose className="h-6 w-6" />
        </button>
      </div>

      {/* Tapping the surround closes. The photo itself does not, or every failed
          swipe would dismiss the viewer. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden" onClick={() => onClose(index)}>
        <div
          className="flex h-full w-full items-center justify-center px-2"
          style={{
            transform: `translate3d(${drag}px, 0, 0)`,
            // No transition while dragging: the photo has to sit under the thumb.
            transition: drag === 0 ? 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <ListingImage
            src={images[index]}
            alt={`${alt} — ${index + 1}`}
            eager
            fallback={t.card.noPhoto}
            className="max-h-full max-w-full object-contain"
          />
        </div>

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                go(-1);
              }}
              aria-label={t.photos.previous}
              className="absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white backdrop-blur transition-colors hover:bg-white/20 sm:flex"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                go(1);
              }}
              aria-label={t.photos.next}
              className="absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white backdrop-blur transition-colors hover:bg-white/20 sm:flex"
            >
              ›
            </button>
          </>
        )}
      </div>

      {/* Thumbnail rail, so a twelve-photo gallery is navigable without twelve
          swipes. Scrolls the active one into view as the photo changes. */}
      {count > 1 && (
        <div className="scrollbar-thin flex shrink-0 gap-2 overflow-x-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              ref={(node) => {
                if (i === index) node?.scrollIntoView({ block: 'nearest', inline: 'center' });
              }}
              onClick={(event) => {
                event.stopPropagation();
                setIndex(i);
              }}
              aria-label={t.photos.show(i + 1)}
              aria-current={i === index}
              className={
                i === index
                  ? 'h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 ring-white'
                  : 'h-14 w-20 shrink-0 overflow-hidden rounded-lg opacity-50 transition-opacity hover:opacity-90'
              }
            >
              <ListingImage src={src} alt="" fallback="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Off-screen, purely to warm the cache for the next swipe. */}
      <div className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden>
        {neighbours.map((src) => (
          <ListingImage key={src} src={src} alt="" fallback="" className="h-px w-px" />
        ))}
      </div>
    </div>
  );
}
