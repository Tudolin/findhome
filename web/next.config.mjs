import path from 'node:path';

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
    unoptimized: true,
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
