import { headers } from 'next/headers';

/**
 * The absolute base URL of this install.
 *
 * Needed wherever a link has to survive leaving the app: a listing pasted into
 * WhatsApp, a party invite, the calendar feed a phone subscribes to. A relative
 * path is useless in all three.
 *
 * `APP_ORIGIN` wins when set, because behind a tunnel or a reverse proxy the
 * request headers describe the hop, not the address anyone types. Without it the
 * forwarded headers are used, then `host` — which is correct on a LAN and is what
 * makes this work with no configuration at all.
 */
export async function appOrigin(): Promise<string> {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const store = await headers();
  const host = store.get('x-forwarded-host') ?? store.get('host') ?? 'localhost:3000';

  // A proxy that terminates TLS forwards the original scheme here; without one,
  // a LAN address is plain http and guessing https would produce a dead link.
  const proto = store.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? (host.includes('localhost') ? 'http' : 'http');

  return `${proto}://${host}`;
}
