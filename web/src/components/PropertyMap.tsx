'use client';

import { useEffect, useRef, useState } from 'react';
import { money } from '@/lib/format';
import { useT } from './LocaleProvider';

/**
 * All listings on one OpenStreetMap, drawn with Leaflet.
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
 * reason the scraper hand-types its in-page `fetch`: the surface used here is
 * four methods wide, and a types-only dependency for that is not worth a
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
type LeafletMarker = LeafletLayer & { bindPopup: (html: string) => LeafletMarker };
type Leaflet = {
  map: (element: HTMLElement, options?: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, options?: Record<string, unknown>) => LeafletLayer;
  marker: (position: [number, number], options?: Record<string, unknown>) => LeafletMarker;
  divIcon: (options: Record<string, unknown>) => unknown;
  featureGroup: (layers: LeafletLayer[]) => { getBounds: () => LatLngBoundsLike };
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

export default function PropertyMap({ pins, withoutCoords }: { pins: MapPin[]; withoutCoords: number }) {
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let map: LeafletMap | null = null;
    let cancelled = false;

    (async () => {
      try {
        await Promise.all([loadOnce('link', LEAFLET_CSS), loadOnce('script', LEAFLET_JS)]);
        if (cancelled || !container.current) return;

        const L = (window as unknown as { L?: Leaflet }).L;
        if (!L) throw new Error('Leaflet did not register itself on window');

        map = L.map(container.current, { scrollWheelZoom: true });

        L.tileLayer(`https://tile.openstreetmap.org/{z}/{x}/{y}.png`, {
          maxZoom: 19,
          // Required by the OSM tile usage policy.
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);

        if (pins.length === 0) {
          // Brazil, roughly — something recognisable rather than the null island.
          map.setView([-15.8, -47.9], 4);
        } else {
          const markers = pins.map((pin) => {
            const label = money(pin.totalPrice).replace(/\s/g, ' ');
            const marker = L.marker([pin.latitude, pin.longitude], {
              // A price label carries far more than a teardrop pin: the whole
              // point of a map view is comparing what costs what, where.
              icon: L.divIcon({
                className: '',
                html:
                  `<span class="fh-pin${pin.pinned ? ' fh-pin-on' : ''}">` +
                  `${pin.pinned ? '📌 ' : ''}${escapeHtml(label)}</span>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              }),
            });

            marker.bindPopup(
              `<strong>${escapeHtml(pin.title.slice(0, 90))}</strong><br>` +
                `${escapeHtml(pin.neighborhood)}, ${escapeHtml(pin.city)}<br>` +
                `${escapeHtml(label)} · ${pin.bedrooms}q · ${pin.sqm}m²<br>` +
                `<a href="/property/${pin.id}">${escapeHtml(t.card.details)}</a>`,
            );

            marker.addTo(map!);
            return marker;
          });

          map.fitBounds(L.featureGroup(markers).getBounds(), { padding: [40, 40], maxZoom: 15 });
        }

        setReady(true);
      } catch (err) {
        setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [pins, t]);

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden p-2">
        <div ref={container} className="h-[65vh] min-h-[24rem] w-full overflow-hidden rounded-xl bg-surface-sunken">
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
        {withoutCoords > 0 && <> · {t.map.missing(withoutCoords)}</>}
      </p>
    </div>
  );
}
