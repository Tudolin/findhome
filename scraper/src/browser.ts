import {
  chromium,
  request,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright-core';
import { randomUUID } from 'node:crypto';
import { config, env } from './config.js';
import { logger } from './logger.js';

const log = logger('browser');

/**
 * Chromium launch flags for a container.
 *
 * --no-sandbox / --disable-setuid-sandbox: the container already isolates the
 * process and there is no user namespace to build a sandbox in.
 * --disable-dev-shm-usage: Docker's default /dev/shm is 64MB, which Chromium
 * will happily blow through and crash on. Writing to /tmp instead is the
 * cheaper fix than raising shm_size.
 * --disable-blink-features=AutomationControlled: drops the `navigator.webdriver`
 * flag that the portals' bot walls check first.
 */
export const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-zygote',
  '--mute-audio',
];

/**
 * Stable for the lifetime of the process. Grupo ZAP's API rejects requests with
 * no device id, and a value that changes on every request looks worse to a rate
 * limiter than one that stays put.
 */
export const DEVICE_ID = env('SCRAPE_DEVICE_ID', randomUUID());

/**
 * Headers a real Chrome sends. The plain HTTP client cannot fake Chrome's TLS
 * fingerprint — that is what BrowserPool is for — but sending the same headers
 * is free and clears the cheaper checks.
 */
export function browserLikeHeaders(): Record<string, string> {
  return {
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    accept: 'application/json, text/plain, */*',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Linux"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: config.headless,
    args: CHROMIUM_ARGS,
    timeout: config.navigationTimeoutMs,
  });
}

export async function createApiContext(): Promise<APIRequestContext> {
  return request.newContext({
    userAgent: config.userAgent,
    timeout: config.navigationTimeoutMs,
    extraHTTPHeaders: browserLikeHeaders(),
  });
}

/** Images, fonts and media are pure weight for a scraper. */
const HEAVY_RESOURCES = new Set(['image', 'font', 'media']);

/**
 * Lazily-launched Chromium, with one reusable page per portal origin.
 *
 * Two reasons this exists rather than a bare `Browser`:
 *
 *  1. Cost. Chromium is ~350MB resident. Launching it only when a parser
 *     actually reaches for it keeps an idle scraper at ~50MB, which matters on
 *     a home server. Nothing here starts a process until `page()` is called.
 *  2. Cookies and TLS. The portals' bot walls fingerprint the TLS handshake and
 *     hand out a clearance cookie from JavaScript. A page parked on the portal's
 *     own origin has both, so `requestJson` can borrow it (see http.ts) when the
 *     plain HTTP client is turned away.
 */
export class BrowserPool {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private readonly anchors = new Map<string, Page>();

  get launched(): boolean {
    return this.browser !== null;
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;

    this.browser = await launchBrowser();
    log.info('chromium launched');

    // One shared context so every page contributes to the same cookie jar —
    // clearance earned on the search page is spent on the API call.
    this.context = await this.browser.newContext({
      userAgent: config.userAgent,
      locale: 'pt-BR',
      timezoneId: config.timezone,
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: { 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' },
    });
    this.context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
    this.context.setDefaultTimeout(config.navigationTimeoutMs);

    await this.context.route('**/*', (route) => {
      if (HEAVY_RESOURCES.has(route.request().resourceType())) return route.abort();
      return route.continue();
    });

    return this.context;
  }

  /** A blank page in the shared context. The caller navigates it. */
  async newPage(): Promise<Page> {
    const context = await this.ensureContext();
    return context.newPage();
  }

  /**
   * A page parked on `origin`, created on first use and reused afterwards.
   * Requests issued from inside it carry that origin's cookies and Chromium's
   * own TLS fingerprint.
   */
  async anchor(origin: string): Promise<Page> {
    const existing = this.anchors.get(origin);
    if (existing && !existing.isClosed()) return existing;

    const page = await this.newPage();
    this.anchors.set(origin, page);

    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      // Bot walls answer with a JS challenge that needs a moment to settle and
      // set its cookie. Failing to go idle is not fatal — the cookie is usually
      // already there.
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      log.debug(`anchored on ${origin}`);
    } catch (err) {
      log.warn(`could not anchor on ${origin}: ${(err as Error).message}`);
    }

    return page;
  }

  async close(): Promise<void> {
    this.anchors.clear();
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
