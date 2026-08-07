import { resolve, sep } from 'node:path';

/**
 * The filesystem half of the photo mirror. Server-only — see the note at the top
 * of ./media, which is the client-safe half.
 */

/**
 * Where the scraper's photo mirror lives, as seen from the web container.
 *
 * Both services mount the same named volume at the same path, so this is one
 * setting shared by two containers rather than two that have to agree.
 */
export const MEDIA_ROOT = resolve(process.env.MEDIA_ROOT || '/media');

/**
 * Resolves a stored path to an absolute one, refusing anything that escapes the
 * root.
 *
 * The paths in the database are generated from a hex digest and can never contain
 * `..` — but this guards a route whose input is the raw URL, and a traversal there
 * would serve arbitrary files off the server. So the check is on the *resolved*
 * path rather than on the input: `resolve()` collapses `..` first, which is what
 * makes `%2e%2e%2f` and every other spelling fall into the same net.
 */
export function resolveMedia(relative: string): string | null {
  if (!relative || relative.includes('\0')) return null;
  const absolute = resolve(MEDIA_ROOT, relative);
  if (absolute !== MEDIA_ROOT && !absolute.startsWith(MEDIA_ROOT + sep)) return null;
  return absolute;
}

/**
 * Content type from the stored extension.
 *
 * An allowlist, not a lookup with a fallback: the mirror only ever writes these
 * five, and returning `application/octet-stream` for anything else would let a
 * stray file on the volume be served as a download.
 */
export function contentTypeFor(path: string): string | null {
  const extension = path.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'gif':
      return 'image/gif';
    default:
      return null;
  }
}
