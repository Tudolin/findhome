import type { PropertySource } from '@prisma/client';
import { config } from './config.js';
import { BrowserPool, createApiContext, sleep } from './browser.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { getParser, mayNeedBrowser } from './parsers/index.js';
import { deactivateStale, persistListings } from './persist.js';
import { buildSearchTargets, describeTarget } from './targets.js';
import type { Transport } from './http.js';
import type { ScrapeContext } from './types.js';

const log = logger('runner');

export type SourceOutcome = {
  source: PropertySource;
  status: 'SUCCESS' | 'FAILED';
  found: number;
  created: number;
  updated: number;
  /** Error message, or the silent-zero note described below. */
  note: string | null;
};

export type RunSummary = {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  targets: number;
  outcomes: SourceOutcome[];
};

let running = false;
let lastSummary: RunSummary | null = null;

export const isRunning = () => running;
export const getLastSummary = () => lastSummary;

/**
 * A source that answers 200 and hands back nothing is the failure mode this
 * project's own comments warn about: it looks exactly like a quiet week on the
 * market. The run is still recorded as SUCCESS — nothing errored — but the note
 * lands in ScrapeRun.error so the dashboard can flag it, because zero listings
 * for a whole city is a broken contract, not a market condition.
 */
const SILENT_ZERO_NOTE =
  'completed without errors but returned 0 listings — the endpoint contract has probably changed. ' +
  'Run `make doctor` to probe it.';

/**
 * One full pass: build search targets from user preferences, run every enabled
 * parser against them, persist with de-duplication, and record a ScrapeRun row
 * per source so failures are visible without reading container logs.
 *
 * A failing source never aborts the others.
 */
export async function runScrape(sources: PropertySource[] = config.sources): Promise<RunSummary> {
  if (running) {
    log.warn('previous run still in progress — skipping this tick');
    throw new Error('A scrape run is already in progress');
  }
  running = true;

  const startedAt = new Date();
  log.info(`starting run · sources=${sources.join(', ')}`);

  // Chromium is launched by the pool on first use, not here: an all-JSON run
  // that is never challenged by a bot wall never pays the ~350MB.
  const browsers = new BrowserPool();
  const api = await createApiContext();
  const transports = new Map<string, Transport>();
  const outcomes: SourceOutcome[] = [];
  let targetCount = 0;

  try {
    const targets = await buildSearchTargets();
    targetCount = targets.length;
    log.info(`${targets.length} search target(s): ${targets.map(describeTarget).join(' · ')}`);

    if (mayNeedBrowser(sources)) {
      log.debug('chromium will be launched on demand');
    }

    for (const source of sources) {
      const parser = getParser(source);
      const run = await prisma.scrapeRun.create({ data: { source, status: 'RUNNING' } });

      const totals = { found: 0, created: 0, updated: 0 };

      try {
        for (const target of targets) {
          const ctx: ScrapeContext = {
            api,
            newPage: () => browsers.newPage(),
            anchor: (origin) => browsers.anchor(origin),
            transports,
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
            `${parser.label} · ${describeTarget(target)}: found ${result.found}, new ${result.created}, ` +
              `refreshed ${result.updated}, skipped ${result.skipped}`,
          );

          await sleep(config.requestDelayMs);
        }

        const deactivated = await deactivateStale(source, config.staleAfterDays);
        if (deactivated > 0) log.info(`${parser.label}: flagged ${deactivated} stale listing(s) inactive`);

        const note = totals.found === 0 && source !== 'DEMO' ? SILENT_ZERO_NOTE : null;
        if (note) log.warn(`${parser.label} ${note}`);

        await prisma.scrapeRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCESS',
            finishedAt: new Date(),
            listingsFound: totals.found,
            listingsCreated: totals.created,
            listingsUpdated: totals.updated,
            error: note,
          },
        });

        outcomes.push({ source, status: 'SUCCESS', ...totals, note });
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

        outcomes.push({ source, status: 'FAILED', ...totals, note: message });
      }
    }
  } finally {
    await api.dispose().catch(() => undefined);
    await browsers.close();
    running = false;
  }

  const finishedAt = new Date();
  const summary: RunSummary = {
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    targets: targetCount,
    outcomes,
  };
  lastSummary = summary;

  const failed = outcomes.filter((o) => o.status === 'FAILED').length;
  log.info(
    `run finished in ${Math.round(summary.durationMs / 1000)}s · ` +
      `${outcomes.length - failed}/${outcomes.length} source(s) ok, ` +
      `${outcomes.reduce((n, o) => n + o.created, 0)} new listing(s)`,
  );

  return summary;
}
