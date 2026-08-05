'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { money, sourceLabel } from '@/lib/format';
import ListingImage from './ListingImage';
import { useT } from './LocaleProvider';

/**
 * All listings on one OpenStreetMap, drawn with Leaflet, plus a legend beside it.
 *
 * ## Why Leaflet comes from a CDN instead of package.json
 *
 * The map's tiles are fetched from tile.openstreetmap.org at view time, so this
 * feature already cannot work without internet access. Loading Leaflet's script
 * and stylesheet the same way therefore introduces no new failure mode — it does
 * not turn a working offline feature into a broken one, because there is no
 * working offline version of a slippy map. In exchange the image stays smaller,
 * the bundle is untouched, and users who never open the map never download it.
 *
 * Vendor it into /public and flip LEAFLET_JS/LEAFLET_CSS to local paths if your
 * box is firewalled to a self-hosted tile server; nothing else needs to change.
 *
 * Types are declared inline rather than pulled from @types/leaflet, for the same
 * reason the scraper hand-types its in-page `fetch`: the surface used here is a
 * handful of methods, and a types-only dependency for that is not worth a
 * lockfile change.
 */

const LEAFLET_VERSION = '1.9.4';
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;

export type MapPin = {
  id: string;
  title: string;
  neighborhood: string;
  city: string;
  totalPrice: number;
  bedrooms: number;
  sqm: number;
  source: string;
  latitude: number;
  longitude: number;
  image: string | null;
  pinned: boolean;
};

/** The slice of Leaflet's API this component uses. */
type LatLngBoundsLike = [[number, number], [number, number]];
type LeafletMap = {
  setView: (center: [number, number], zoom: number) => LeafletMap;
  fitBounds: (bounds: LatLngBoundsLike, options?: { padding?: [number, number]; maxZoom?: number }) => LeafletMap;
  remove: () => void;
};
type LeafletLayer = { addTo: (map: LeafletMap) => LeafletLayer };
type LeafletMarker = LeafletLayer & {
  bindPopup: (html: string, options?: Record<string, unknown>) => LeafletMarker;
  openPopup: () => LeafletMarker;
  on: (event: string, handler: () => void) => LeafletMarker;
};
type Leaflet = {
  map: (element: HTMLElement, options?: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, options?: Record<string, unknown>) => LeafletLayer;
  marker: (position: [number, number], options?: Record<string, unknown>) => LeafletMarker;
  divIcon: (options: Record<string, unknown>) => unknown;
};

/** Loads a stylesheet / script once, resolving when ready. */
function loadOnce(tag: 'link' | 'script', url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const selector = tag === 'link' ? `link[href="${url}"]` : `script[src="${url}"]`;
    const existing = document.querySelector(selector);
    if (existing) {
      if (existing.getAttribute('data-loaded') === 'true') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`failed to load ${url}`)));
      return;
    }

    const element = document.createElement(tag);
    element.addEventListener('load', () => {
      element.setAttribute('data-loaded', 'true');
      resolve();
    });
    element.addEventListener('error', () => reject(new Error(`failed to load ${url}`)));

    if (tag === 'link') {
      (element as HTMLLinkElement).rel = 'stylesheet';
      (element as HTMLLinkElement).href = url;
    } else {
      (element as HTMLScriptElement).src = url;
      (element as HTMLScriptElement).async = true;
    }
    document.head.appendChild(element);
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The box to zoom into: the 5th–95th percentile of the pins, not their full
 * extent.
 *
 * Fitting the raw min/max means one mislocated listing — a geocoder that
 * resolved a vague address to the middle of the state — zooms the map out until
 * the city is a dot. Trimming the tails keeps the view on the city the user
 * actually chose, which is what "zoom to my city" means in practice.
 */
function focusBounds(pins: MapPin[]): LatLngBoundsLike | null {
  if (pins.length === 0) return null;
  if (pins.length < 5) {
    const lats = pins.map((p) => p.latitude);
    const lngs = pins.map((p) => p.longitude);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
  }

  const at = (values: number[], q: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
  };
  const lats = pins.map((p) => p.latitude);
  const lngs = pins.map((p) => p.longitude);

  return [
    [at(lats, 0.05), at(lngs, 0.05)],
    [at(lats, 0.95), at(lngs, 0.95)],
  ];
}

export default function PropertyMap({
  pins,
  withoutCoords,
  city,
}: {
  pins: MapPin[];
  withoutCoords: number;
  city: string | null;
}) {
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  // Cheapest listing first: the legend is for comparing, and that is the order
  // people compare in.
  const ordered = useMemo(() => [...pins].sort((a, b) => a.totalPrice - b.totalPrice), [pins]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await Promise.all([loadOnce('link', LEAFLET_CSS), loadOnce('script', LEAFLET_JS)]);
        if (cancelled || !container.current) return;

        const L = (window as unknown as { L?: Leaflet }).L;
        if (!L) throw new Error('Leaflet did not register itself on window');

        const map = L.map(container.current, { scrollWheelZoom: true });
        mapRef.current = map;

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          // Required by the OSM tile usage policy.
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);

        const bounds = focusBounds(pins);
        if (!bounds) {
          // Brazil, roughly — something recognisable rather than the null island.
          map.setView([-15.8, -47.9], 4);
        }

        for (const pin of pins) {
          const label = money(pin.totalPrice);
          const marker = L.marker([pin.latitude, pin.longitude], {
            // A price label carries far more than a teardrop pin: the whole
            // point of a map view is comparing what costs what, where.
            icon: L.divIcon({
              className: '',
              html:
                `<span class="fh-pin${pin.pinned ? ' fh-pin-on' : ''}" data-id="${pin.id}">` +
                `${pin.pinned ? '📌 ' : ''}${escapeHtml(label)}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
          });

          // The popup is raw HTML built outside React, so referrerpolicy has to
          // be written by hand here — without it the OLX CDN 403s the photo.
          // See ListingImage.tsx for the measurement.
          const photo = pin.image
            ? `<img src="${escapeHtml(pin.image)}" alt="" referrerpolicy="no-referrer" class="fh-popup-img">`
            : '';

          marker.bindPopup(
            `${photo}<strong>${escapeHtml(pin.title.slice(0, 90))}</strong><br>` +
              `${escapeHtml(pin.neighborhood)}, ${escapeHtml(pin.city)}<br>` +
              `${escapeHtml(label)} · ${pin.bedrooms}q · ${pin.sqm}m² · ${escapeHtml(sourceLabel(pin.source))}<br>` +
              `<a href="/property/${pin.id}">${escapeHtml(t.card.details)}</a>`,
            { minWidth: 220 },
          );

          marker.on('popupopen', () => setActive(pin.id));
          marker.addTo(map);
          markersRef.current.set(pin.id, marker);
        }

        if (bounds) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });

        setReady(true);
      } catch (err) {
        setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      markersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [pins, t]);

  /** Clicking a legend row focuses its marker. */
  const focus = (pin: MapPin) => {
    setActive(pin.id);
    mapRef.current?.setView([pin.latitude, pin.longitude], 16);
    markersRef.current.get(pin.id)?.openPopup();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-3">
        <div className="card overflow-hidden p-2">
          <div ref={container} className="h-[65vh] min-h-[26rem] w-full overflow-hidden rounded-xl bg-surface-sunken">
            {!ready && !error && (
              <div className="flex h-full items-center justify-center text-sm text-ink-400">{t.common.loading}</div>
            )}
            {error && (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-warning">
                {t.map.loadFailed}
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-ink-500">
          {t.map.shown(pins.length)}
          {city && ` · ${city}`}
          {withoutCoords > 0 && <> · {t.map.missing(withoutCoords)}</>}
        </p>
      </div>

      {/* The legend. Not a decoration: a price pin tells you what, this tells you
          which — and it is the only way to reach a listing whose marker is
          underneath another one. */}
      <aside className="card flex max-h-[calc(65vh+3.5rem)] flex-col overflow-hidden">
        <h2 className="label border-b border-ink-200 !mb-0 px-4 py-3">{t.map.legend}</h2>

        {ordered.length === 0 ? (
          <p className="p-4 text-xs text-ink-500">{t.map.noneWithCoords}</p>
        ) : (
          <ul className="scrollbar-thin divide-y divide-ink-200 overflow-y-auto">
            {ordered.map((pin) => (
              <li key={pin.id}>
                <button
                  type="button"
                  onClick={() => focus(pin)}
                  className={clsx(
                    'flex w-full items-start gap-3 p-3 text-left transition-colors',
                    active === pin.id ? 'bg-surface-sunken' : 'hover:bg-surface-sunken',
                  )}
                >
                  <span className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
                    <ListingImage
                      src={pin.image}
                      alt=""
                      fallback=""
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <strong className="text-sm font-black tabular-nums text-ink-900">
                        {money(pin.totalPrice)}
                      </strong>
                      {pin.pinned && <span aria-label={t.card.pinned}>📌</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-semibold text-ink-600">
                      {pin.neighborhood}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-ink-400">
                      {pin.bedrooms} {t.card.bed} · {pin.sqm} m² · {sourceLabel(pin.source)}
                    </span>
                  </span>
                </button>
                <Link
                  href={`/property/${pin.id}`}
                  className="block px-3 pb-2 text-[11px] font-semibold text-brand-700 hover:text-brand-800"
                >
                  {t.card.details} →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
