/**
 * The photo mirror, as the UI sees it.
 *
 * **Deliberately free of `node:` imports.** PropertyCard and PhotoCarousel are
 * client components, so anything they reach must be bundleable for the browser;
 * the filesystem half of the mirror lives in ./media-server instead. Splitting
 * them is what keeps `displayImages` usable on both sides of the boundary rather
 * than forcing every caller to pre-resolve on the server.
 */

/** Prefix of every locally served photo. The one place that spells it. */
export const MEDIA_PREFIX = '/media/';

/** Public URL for a mirrored photo. Served by app/media/[...path]/route.ts. */
export const mediaUrl = (path: string) => `${MEDIA_PREFIX}${path}`;

/** True for a URL this app serves itself, rather than a portal CDN. */
export const isMirrored = (url: string) => url.startsWith(MEDIA_PREFIX);

/**
 * Identity of a photo, ignoring the query string.
 *
 * Must stay in step with `photoKey` in the scraper (media.ts, persist.ts,
 * photos.ts). These CDNs decorate one file with per-request parameters, so a
 * literal URL comparison would miss every mirrored photo.
 */
export const photoKey = (url: string) => url.split('?')[0].split('#')[0];

/** The mirror index as it arrives from a query, before it becomes display URLs. */
export type MirroredPhoto = { remoteUrl: string; path: string | null };

type Gallery = { images: string[]; photos?: MirroredPhoto[] | null };

/**
 * The URLs a gallery should actually render, in the portal's own order.
 *
 * `Property.images` stays canonical — it is the ordered list of portal URLs, and
 * this never adds to it or reorders it. All it does is swap in the local copy
 * where one exists. So the app behaves exactly as it did before mirroring existed
 * when `photos` is empty, which is what makes the feature safe to turn off.
 */
export function displayImages(property: Gallery): string[] {
  const mirror = property.photos;
  if (!mirror || mirror.length === 0) return property.images;

  const byKey = new Map<string, string>();
  for (const photo of mirror) {
    if (photo.path) byKey.set(photoKey(photo.remoteUrl), photo.path);
  }
  if (byKey.size === 0) return property.images;

  return property.images.map((url) => {
    const path = byKey.get(photoKey(url));
    return path ? mediaUrl(path) : url;
  });
}

/** First image only, for a card or a map pin. */
export function displayImage(property: Gallery): string | undefined {
  const mirror = property.photos;
  const first = property.images[0];
  if (!first || !mirror?.length) return first;

  const key = photoKey(first);
  const match = mirror.find((photo) => photo.path && photoKey(photo.remoteUrl) === key);
  return match?.path ? mediaUrl(match.path) : first;
}

/** What a gallery can actually show, and what it has lost. */
export type GalleryView = {
  /** URLs that are safe to render, in the portal's order. May be empty. */
  images: string[];
  /** How many photos the listing had while it was live. */
  total: number;
  /** Photos that exist only as a URL we no longer trust. */
  missing: number;
  /** The ad is closed: this is a record, not something you can go and see. */
  archived: boolean;
};

/**
 * Resolves a gallery for rendering, and it is the archived case that makes this
 * more than a rename of `displayImages`.
 *
 * When an ad closes, its photo URLs usually die with it — the CDN drops the files
 * a little while after the listing goes. Rendering them anyway is what turns an
 * archived flat into a wall of grey placeholders, which is the worst possible
 * outcome for the one screen where you are trying to remember which of three
 * apartments had the good kitchen.
 *
 * So the rule for a closed ad is: **render only what we hold locally.** Nothing
 * else is trustworthy. `missing` is the count we deliberately did not attempt, so
 * the UI can say "12 photos are no longer available" instead of showing twelve
 * broken frames — a stated absence beats an implied one.
 *
 * A live listing behaves exactly as before: everything, mirrored where possible.
 */
export function galleryFor(property: Gallery & { active?: boolean }): GalleryView {
  const total = property.images.length;
  const archived = property.active === false;

  if (!archived) {
    return { images: displayImages(property), total, missing: 0, archived: false };
  }

  const images = displayImages(property).filter(isMirrored);
  return { images, total, missing: Math.max(0, total - images.length), archived: true };
}
