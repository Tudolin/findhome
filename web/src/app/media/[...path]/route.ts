import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { contentTypeFor, resolveMedia } from '@/lib/media-server';

/**
 * Serves a mirrored listing photo off the shared volume.
 *
 *   GET /media/a3/a3f19c…c4.webp
 *
 * ## Why this is not behind the auth middleware
 *
 * The middleware matcher deliberately excludes this path (see
 * `web/src/middleware.ts`). Three reasons:
 *
 *  1. The URL is a SHA-256 of the portal's own URL. It is unguessable, and the
 *     content behind it is a photograph that is already public on the portal —
 *     there is nothing here that a session protects.
 *  2. Requiring a cookie would break the one thing the mirror exists for: a
 *     stable `<img src>` that keeps working. Redirecting an image request to
 *     /login renders a broken image, not a login screen.
 *  3. It keeps this route cheap. No session verification, no database call — just
 *     a stat and a stream.
 *
 * ## Caching
 *
 * Content-addressed, so the bytes at a path can never change: `immutable` with a
 * one-year max-age is exactly right, and it means a carousel is re-read from disk
 * once per browser rather than once per page view.
 */

/**
 * Node runtime, not Edge: this reads the filesystem.
 *
 * No `dynamic` export on purpose. `force-static` would ask Next to prerender a
 * handler whose whole job is to read a file that does not exist at build time;
 * `force-dynamic` would be harmless but says nothing. GET route handlers are
 * uncached by default in Next 15, and the `immutable` header below is what
 * actually does the caching — in the browser, where it belongs.
 */
export const runtime = 'nodejs';

const IMMUTABLE = 'public, max-age=31536000, immutable';

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;

  // Rejoined with '/' rather than the platform separator: these paths are stored
  // in the database with forward slashes and the guard below compares against a
  // platform-resolved root.
  const relative = (path ?? []).join('/');

  const absolute = resolveMedia(relative);
  const contentType = contentTypeFor(relative);

  // One response for "escaped the root", "not an image extension" and "not
  // there": a probe must not be able to tell them apart.
  if (!absolute || !contentType) return new Response('Not found', { status: 404 });

  let size: number;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return new Response('Not found', { status: 404 });
    size = info.size;
  } catch {
    // Evicted by the disk budget, or never mirrored. The app falls back to the
    // portal URL on its own (see displayImages), so this is not an error state.
    return new Response('Not found', { status: 404 });
  }

  // Streamed rather than buffered: a 4 MB photo should not become 4 MB of heap
  // in a container capped at 512 MB.
  const stream = Readable.toWeb(createReadStream(absolute)) as unknown as ReadableStream;

  return new Response(stream, {
    headers: {
      'content-type': contentType,
      'content-length': String(size),
      'cache-control': IMMUTABLE,
      // These are third-party photographs held on our disk. Nothing should be
      // able to hotlink them into another origin's page as if they were ours.
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    },
  });
}
