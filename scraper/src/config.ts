import type { PropertySource } from '@prisma/client';

/**
 * Reads an optional string setting, treating an empty value as absent.
 *
 * This is not pedantry. docker-compose.yml passes optional settings as
 * `FOO: ${FOO:-}`, which sets the variable to the EMPTY STRING rather than
 * leaving it unset — so `process.env.FOO ?? fallback` keeps the empty string and
 * the fallback never happens. That turned an unset GRUPOZAP_ENDPOINT into a
 * request against "" and a `TypeError: Invalid URL`.
 */
export const env = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
};

/** Same emptiness rule, but with no fallback: returns undefined when unset. */
export const envOptional = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
};

const bool = (value: string | undefined, fallback: boolean) =>
  value === undefined || value.trim() === '' ? fallback : value.toLowerCase() === 'true';

const int = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const ALL_SOURCES: PropertySource[] = [
  'ZAP',
  'VIVA_REAL',
  'QUINTO_ANDAR',
  'OLX',
  'CHAVES_NA_MAO',
  'IMOVELWEB',
  'DEMO',
];

/**
 * Shared by SCRAPE_SOURCES, the CLI argument and the control API's `sources`
 * body, so an unknown name is rejected the same way whichever door it arrives
 * through.
 */
export function parseSources(value: string | undefined): PropertySource[] {
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
  cron: env('SCRAPE_CRON', '0 8,20 * * *'),
  timezone: env('TZ', 'America/Sao_Paulo'),
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
  userAgent: env(
    'SCRAPE_USER_AGENT',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ),
  /**
   * Fallback search target used when no PreferenceProfile exists yet, so a
   * fresh install still pulls something down on the first run. Also supplies
   * the state for profiles saved before the state field existed.
   */
  defaultCity: env('SCRAPE_DEFAULT_CITY', 'São Paulo'),
  defaultState: env('SCRAPE_DEFAULT_STATE', 'SP'),

  // --- Manual-trigger control API (src/server.ts) ---------------------------
  /**
   * Small HTTP endpoint the web app calls for "Run scrape now". The port is
   * never published by compose, so it is reachable only from inside the
   * `findhome` bridge network.
   */
  controlEnabled: bool(process.env.SCRAPE_CONTROL_ENABLED, true),
  controlPort: int(process.env.SCRAPE_CONTROL_PORT, 8080),
  /**
   * Shared secret the caller must present as `x-scrape-token`. Empty means no
   * check — acceptable only because the port is private, and warned about at
   * boot.
   */
  controlToken: env('SCRAPE_CONTROL_TOKEN', ''),
};

export type Config = typeof config;
