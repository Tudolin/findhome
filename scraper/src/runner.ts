import type { PropertySource } from '@prisma/client';
import { config } from './config.js';
import { createApiContext, launchBrowser, sleep } from './browser.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { getParser, needsBrowser } from './parsers/index.js';
import { deactivateStale, persistListings } from './persist.js';
import { buildSearchTargets } from './targets.js';
import type { Browser } from 'playwright-core';
import type { ScrapeContext } from './types.js';

const log = logger('runner');

let running = false;

/**
 * One full pass: build search targets from user preferences, run every enabled
 * parser against them, persist with de-duplication, and record a ScrapeRun row
 * per source so failures are visible without reading container logs.
 *
 * A failing source never aborts the others.
 */
export async function runScrape(sources: PropertySource[] = config.sources): Promise<void> {
  if (running) {
    log.warn('previous run still in progress — skipping this tick');
    return;
  }
  running = true;

  const startedAt = Date.now();
  log.info(`starting run · sources=${sources.join(', ')}`);

  let browser: Browser | null = null;
  const api = await createApiContext();

  try {
    const targets = await buildSearchTargets();
    log.info(`${targets.length} search target(s): ${targets.map((t) => t.city).join(', ')}`);

    // Chromium is only launched when a parser actually needs a page — keeps
    // idle memory at ~50MB instead of ~400MB on a small server.
    if (needsBrowser(sources)) {
      browser = await launchBrowser();
      log.info('chromium launched');
    }

    for (const source of sources) {
      const parser = getParser(source);
      const run = await prisma.scrapeRun.create({ data: { source, status: 'RUNNING' } });

      const totals = { found: 0, created: 0, updated: 0 };

      try {
        for (const target of targets) {
          const ctx: ScrapeContext = {
            // Parsers that need a browser are the only ones that touch this,
            // and needsBrowser() guarantees it was launched for them.
            browser: browser as Browser,
            api,
            log: logger(parser.label),
            maxPages: config.maxPages,
            pageSize: config.pageSize,
            delay: () => sleep(config.requestDelayMs),
          };

          const listings = await parser.search(target, ctx);
          const result = await persistListings(source, listings);

          totals.found += result.found;
          totals.created += result.created;
          totals.updated += result.updated;

          log.info(
            `${parser.label} · ${target.city}: found ${result.found}, new ${result.created}, ` +
              `refreshed ${result.updated}, skipped ${result.skipped}`,
          );

          await sleep(config.requestDelayMs);
        }

        const deactivated = await deactivateStale(source, config.staleAfterDays);
        if (deactivated > 0) log.info(`${parser.label}: flagged ${deactivated} stale listing(s) inactive`);

        await prisma.scrapeRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCESS',
            finishedAt: new Date(),
            listingsFound: totals.found,
            listingsCreated: totals.created,
            listingsUpdated: totals.updated,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`${parser.label} failed: ${message}`);
        await prisma.scrapeRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            listingsFound: totals.found,
            listingsCreated: totals.created,
            listingsUpdated: totals.updated,
            error: message.slice(0, 1000),
          },
        });
      }
    }
  } finally {
    await api.dispose().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    running = false;
    log.info(`run finished in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  }
}
