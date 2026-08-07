# syntax=docker/dockerfile:1
#
# FindHome — web service (Next.js App Router: UI + REST API).
# Build context is the REPOSITORY ROOT so that /prisma (the shared schema)
# and /web (this app) both land in the image with their real relative paths.
#
#   /app/prisma/schema.prisma
#   /app/web/...            <- WORKDIR
#
# Stages:
#   deps    - production+dev npm install (cached on package.json alone)
#   builder - prisma generate + next build
#   tools   - full toolchain image used by the one-shot `migrate` service
#   runner  - lean standalone runtime (default target)

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
# Prisma's query engine links against OpenSSL 3; bookworm-slim ships without it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
# `npm ci` when a lockfile is present, otherwise fall back to `npm install`
# so the project builds on a fresh clone with no lockfile committed.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY prisma ./prisma
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY web ./web
WORKDIR /app/web
RUN npx prisma generate --schema=../prisma/schema.prisma
RUN npm run build

# ---------------------------------------------------------------------------
# Toolchain image: has the Prisma CLI, migrations and the seed script.
# Used by the `migrate` compose service; never exposed to the network.
FROM base AS tools
WORKDIR /app
COPY prisma ./prisma
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY web/package.json ./web/package.json
COPY web/scripts ./web/scripts
# The seed imports src/lib/locations so it writes the same city/neighborhood
# slugs the app filters on. Only lib/ is needed — this image never renders.
COPY web/src/lib ./web/src/lib
COPY --from=builder /app/web/node_modules/.prisma ./web/node_modules/.prisma
WORKDIR /app/web
CMD ["npx", "prisma", "migrate", "deploy", "--schema=../prisma/schema.prisma"]

# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Mount point for the photo mirror (read-only here — the scraper is the writer).
# Created with the same uid the scraper image uses, so a fresh named volume comes
# up owned by 1001 whichever of the two containers happens to start first. Without
# it in *both* images, the volume initialises root-owned from whichever one lacks
# the directory, and the scraper can never write to it.
RUN mkdir -p /media && chown 1001:1001 /media

# .next/standalone mirrors the tracing root (/app), so it already contains
# web/server.js and the traced node_modules tree.
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public
# Prisma's generated client + native query engine are loaded at runtime by
# path, which file tracing does not always follow. Copy them explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/web/node_modules/.prisma ./web/node_modules/.prisma

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "web/server.js"]
