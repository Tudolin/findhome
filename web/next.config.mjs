import path from 'node:path';

/**
 * Content Security Policy.
 *
 * Shaped by three things the app actually does:
 *   - an inline <script> in <head> applies the theme before first paint, so
 *     'unsafe-inline' is required for scripts until that is converted to a nonce;
 *   - the map loads Leaflet from unpkg and tiles from tile.openstreetmap.org;
 *   - listing photos come from whatever CDN the portal used, so img-src is open.
 *
 * So this is a hardening baseline, not an XSS-proof policy — `script-src` with
 * 'unsafe-inline' is the weak link, and it is stated here rather than implied.
 * What it does buy: no framing, no plugins, no form posts or base-tag hijacking
 * to another origin, and no unexpected outbound connections from the page.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self' https://tile.openstreetmap.org https://unpkg.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/**
 * Static headers only.
 *
 * `headers()` is evaluated at BUILD time and baked into the routes manifest, so
 * nothing here may depend on runtime configuration — an env-gated header would
 * silently reflect whatever was set when the image was built, not what is in
 * `.env` on the server.
 *
 * That is why there is no Strict-Transport-Security here. It has to be
 * conditional on TLS actually being terminated in front of the app (sending it
 * over plain http:// on a LAN pins the browser to https for a host with no
 * certificate, and HSTS is not something a household can easily undo), and the
 * right place for a TLS-dependent header is the proxy that terminates the TLS.
 * See the Security notes in the README.
 */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Listing URLs and the calendar-feed token both live in paths, so no referrer
  // should ever leave this origin. Matches the per-image policy in ListingImage.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces .next/standalone — a self-contained server with only the traced
  // dependencies. Keeps the runtime image small (~200MB instead of ~700MB).
  output: 'standalone',
  // The app lives in <repo>/web but the Prisma schema lives in <repo>/prisma,
  // so tracing has to start one level up from the Next.js project.
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Listing photos come from arbitrary third-party CDNs and re-encoding them
    // would burn CPU on a home server for no benefit. Serve them as-is.
    //
    // `unoptimized` is also what makes the wildcard below safe: with
    // optimization on, Next would fetch any URL a page asked for, turning the
    // server into an open proxy.
    unoptimized: true,
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
