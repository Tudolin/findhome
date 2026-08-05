import type { PropertySource } from '@prisma/client';

const bool = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : value.toLowerCase() === 'true';

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ALL_SOURCES: PropertySource[] = ['ZAP', 'VIVA_REAL', 'QUINTO_ANDAR', 'OLX', 'DEMO'];

function parseSources(value: string | undefined): PropertySource[] {
  if (!value) return ['DEMO'];
  const wanted = value
    .split(',')
    .map((s) => s.trim().toUpperCase().replace(/[\s-]+/g, '_'))
    .filter(Boolean);
  const invalid = wanted.filter((s) => !ALL_SOURCES.includes(s as PropertySource));
  if (invalid.length) {
    throw new Error(
      `Unknown SCRAPE_SOURCES entries: ${invalid.join(', ')}. Valid values: ${ALL_SOURCES.join(', ')}`,
    );
  }
  return wanted as PropertySource[];
}

export const config = {
  /** Standard 5-field cron. Default: 08:00 and 20:00 every day. */
  cron: process.env.SCRAPE_CRON ?? '0 8,20 * * *',
  timezone: process.env.TZ ?? 'America/Sao_Paulo',
  /** Run one pass immediately at container start instead of waiting for cron. */
  runOnStart: bool(process.env.SCRAPE_ON_START, true),
  sources: parseSources(process.env.SCRAPE_SOURCES),
  /** Result pages to walk per source per search target. */
  maxPages: int(process.env.SCRAPE_MAX_PAGES, 2),
  pageSize: int(process.env.SCRAPE_PAGE_SIZE, 40),
  /** Politeness delay between requests, in ms. */
  requestDelayMs: int(process.env.SCRAPE_DELAY_MS, 1500),
  navigationTimeoutMs: int(process.env.SCRAPE_TIMEOUT_MS, 45_000),
  /** Listings not seen for this many days are flagged inactive. */
  staleAfterDays: int(process.env.SCRAPE_STALE_DAYS, 21),
  headless: bool(process.env.SCRAPE_HEADLESS, true),
  userAgent:
    process.env.SCRAPE_USER_AGENT ??
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  /**
   * Fallback search target used when no PreferenceProfile exists yet, so a
   * fresh install still pulls something down on the first run.
   */
  defaultCity: process.env.SCRAPE_DEFAULT_CITY ?? 'São Paulo',
  defaultState: process.env.SCRAPE_DEFAULT_STATE ?? 'SP',
};

export type Config = typeof config;
