# syntax=docker/dockerfile:1
#
# FindHome — headless scraping engine.
# Build context is the REPOSITORY ROOT (shares /prisma with the web service).
#
#   /app/prisma/schema.prisma
#   /app/scraper/...        <- WORKDIR
#
# Why not mcr.microsoft.com/playwright: it ships Chromium, Firefox AND WebKit
# and weighs ~3.9GB. We only ever drive Chromium, headlessly, so we install the
# Chromium headless shell onto the same slim Node base the web service uses.
# Base layers are then shared between the two images.
#
# PLAYWRIGHT_VERSION MUST match the playwright-core version in package.json:
# playwright-core looks for a browser build whose revision is pinned to its own
# version, and a mismatch fails at launch, not at build.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PLAYWRIGHT_VERSION=1.62.1

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
# Prisma's query engine links against OpenSSL 3.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

# ---------------------------------------------------------------------------
# Full install (incl. typescript/tsx/prisma CLI) — build only.
FROM base AS deps
WORKDIR /app/scraper
COPY scraper/package.json scraper/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---------------------------------------------------------------------------
# Runtime-only install. Keeps ~150MB of build tooling out of the final image.
FROM base AS prod-deps
WORKDIR /app/scraper
COPY scraper/package.json scraper/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY prisma ./prisma
COPY --from=deps /app/scraper/node_modules ./scraper/node_modules
COPY scraper ./scraper
WORKDIR /app/scraper
RUN npx prisma generate --schema=../prisma/schema.prisma \
    && npx tsc -p tsconfig.json

# ---------------------------------------------------------------------------
FROM base AS runner
ARG PLAYWRIGHT_VERSION
ENV NODE_ENV=production

# Chromium's headless shell plus only the system libraries it needs.
# `--with-deps` resolves the apt list for this distro so it does not have to be
# maintained by hand; `--only-shell` skips the full headed browser, which a
# container has no display for anyway.
RUN npx --yes playwright@${PLAYWRIGHT_VERSION} install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache

# Created before the COPYs so `--chown` can set ownership inline. A separate
# `chown -R` would rewrite every file and duplicate node_modules into a second
# ~300MB layer.
RUN groupadd --system --gid 1001 scraper \
    && useradd --system --uid 1001 --gid scraper --create-home scraper

WORKDIR /app
COPY --chown=scraper:scraper prisma ./prisma
COPY --from=prod-deps --chown=scraper:scraper /app/scraper/node_modules ./scraper/node_modules
COPY --from=builder --chown=scraper:scraper /app/scraper/node_modules/.prisma ./scraper/node_modules/.prisma
COPY --from=builder --chown=scraper:scraper /app/scraper/dist ./scraper/dist
COPY --chown=scraper:scraper scraper/package.json ./scraper/package.json

WORKDIR /app/scraper
# Chromium still runs with --no-sandbox (see src/browser.ts): a container has
# no user namespace to build the sandbox in. Running as non-root is the
# compensating control.
USER scraper

CMD ["node", "dist/index.js"]
