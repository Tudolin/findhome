import type { ScrapeContext } from './types.js';

/**
 * One JSON request, over whichever transport gets through.
 *
 * ## Why this is not just `api.get()`
 *
 * The portals' JSON endpoints sit behind bot protection that fingerprints the
 * TLS handshake. Playwright's `APIRequestContext` speaks through Node's TLS
 * stack, so no matter how convincing the headers are, the handshake says
 * "Node", and Cloudflare answers 403 — which is exactly the failure this
 * project hit on ZAP and Viva Real.
 *
 * So each request gets up to two attempts:
 *
 *   direct  — Node's HTTP client. Cheap, no browser process. Tried first.
 *   browser — the same request issued by `fetch()` *inside a Chromium page*
 *             parked on the portal's own origin. Chromium's TLS fingerprint,
 *             Chromium's cookie jar, and a same-site Origin header. This is
 *             what the portal's own SPA looks like, because it is what the
 *             portal's own SPA does.
 *
 * The browser attempt is cross-origin (www.zapimoveis.com.br calling
 * glue-api.zapimoveis.com.br) and relies on the CORS headers the endpoint
 * already returns for its own front-end. That is the point: we are borrowing
 * the front-end's seat, not inventing a new one.
 */

export type Transport = 'direct' | 'browser';

export type JsonRequest = {
  url: string;
  method?: 'GET' | 'POST';
  /** Extra headers. `origin` and `referer` are supplied from `origin` below. */
  headers?: Record<string, string>;
  /** Serialised as JSON for POST. */
  body?: unknown;
  /**
   * The portal page this request belongs to, e.g. https://www.zapimoveis.com.br.
   * The browser transport anchors on it; the direct transport sends it as the
   * Origin/Referer pair.
   */
  origin: string;
  /**
   * Groups requests that share a bot-wall verdict (normally one per portal).
   * Once a transport works for a channel it is tried first for the rest of the
   * run, so page 2 does not pay for another rejected direct attempt.
   */
  channel: string;
};

export type JsonResult = {
  status: number;
  ok: boolean;
  transport: Transport;
  contentType: string;
  /** Raw body, capped. Kept for diagnostics — see doctor.ts. */
  bodyText: string;
  /** Parsed body, or null when the response was not JSON. */
  json: unknown;
};

const BODY_SNIPPET = 2000;

/**
 * Statuses worth retrying over the browser transport. 403/401 are the bot wall;
 * 429 and 5xx can be the wall rate-limiting a suspicious client. A 404 is a
 * genuine "wrong URL" and escalating would only waste a browser launch.
 */
function shouldEscalate(status: number, json: unknown): boolean {
  if (status === 401 || status === 403 || status === 405 || status === 406 || status === 429) return true;
  if (status >= 500) return true;
  // 200 with a non-JSON body means an interstitial ("checking your browser…")
  // was served instead of the API response.
  if (status === 200 && json === null) return true;
  return false;
}

function parse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function attemptDirect(ctx: ScrapeContext, req: JsonRequest): Promise<JsonResult> {
  const headers: Record<string, string> = {
    origin: req.origin,
    referer: `${req.origin}/`,
    ...req.headers,
  };

  const method = req.method ?? 'GET';
  const response =
    method === 'POST'
      ? await ctx.api.post(req.url, {
          headers: { 'content-type': 'application/json', ...headers },
          data: req.body ?? {},
          failOnStatusCode: false,
        })
      : await ctx.api.get(req.url, { headers, failOnStatusCode: false });

  const text = await response.text().catch(() => '');
  return {
    status: response.status(),
    ok: response.ok(),
    transport: 'direct',
    contentType: response.headers()['content-type'] ?? '',
    bodyText: text.slice(0, BODY_SNIPPET),
    json: parse(text),
  };
}

type PageFetchResult = { status: number; contentType: string; text: string; error?: string };

async function attemptBrowser(ctx: ScrapeContext, req: JsonRequest): Promise<JsonResult> {
  const page = await ctx.anchor(req.origin);

  const payload = {
    url: req.url,
    method: req.method ?? 'GET',
    headers: { ...(req.method === 'POST' ? { 'content-type': 'application/json' } : {}), ...req.headers },
    body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : null,
  };

  const result = (await page.evaluate(async (input: typeof payload): Promise<PageFetchResult> => {
    // This function is serialised and run inside the page, where `fetch` lives.
    // The scraper's tsconfig has no DOM lib on purpose (it is a Node service),
    // so the page's globals are reached through a locally typed `globalThis`
    // rather than by pulling the whole DOM typing surface into the project.
    const scope = globalThis as unknown as {
      fetch: (
        url: string,
        init: Record<string, unknown>,
      ) => Promise<{
        status: number;
        headers: { get(name: string): string | null };
        text(): Promise<string>;
      }>;
    };

    try {
      const response = await scope.fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        credentials: 'include',
        mode: 'cors',
      });
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        text: await response.text(),
      };
    } catch (err) {
      // A CORS rejection or network error surfaces here as a TypeError; report
      // it as status 0 so the caller can tell it apart from an HTTP status.
      return { status: 0, contentType: '', text: '', error: (err as Error).message };
    }
  }, payload)) as PageFetchResult;

  if (result.error) {
    return {
      status: 0,
      ok: false,
      transport: 'browser',
      contentType: '',
      bodyText: `in-page fetch failed: ${result.error}`,
      json: null,
    };
  }

  return {
    status: result.status,
    ok: result.status >= 200 && result.status < 300,
    transport: 'browser',
    contentType: result.contentType,
    bodyText: result.text.slice(0, BODY_SNIPPET),
    json: parse(result.text),
  };
}

/**
 * Runs `req` over the best transport available, escalating from direct to
 * browser when the response looks like a bot wall rather than an answer.
 */
export async function requestJson(ctx: ScrapeContext, req: JsonRequest): Promise<JsonResult> {
  const preferred = ctx.transports.get(req.channel);
  const order: Transport[] = preferred === 'browser' ? ['browser'] : ['direct', 'browser'];

  let last: JsonResult | null = null;

  for (const transport of order) {
    const result = transport === 'direct' ? await attemptDirect(ctx, req) : await attemptBrowser(ctx, req);
    last = result;

    if (result.ok && result.json !== null) {
      if (preferred !== transport) {
        ctx.transports.set(req.channel, transport);
        if (transport === 'browser') {
          ctx.log.info(`${req.channel}: direct request was refused, continuing through Chromium`);
        }
      }
      return result;
    }

    if (!shouldEscalate(result.status, result.json)) return result;
    if (transport === 'direct') {
      ctx.log.debug(`${req.channel}: direct attempt returned ${result.status}, escalating to Chromium`);
    }
  }

  return last!;
}

/** Short, human-readable description of a failed response, for error messages. */
export function describeFailure(label: string, result: JsonResult): string {
  const status = result.status === 0 ? 'no response' : `HTTP ${result.status}`;
  const hint =
    result.status === 403 || result.status === 401
      ? ' (bot wall — even Chromium was refused; try again later or from another IP)'
      : result.status === 404
        ? ' (endpoint moved — run `make doctor` to probe the known alternatives)'
        : result.json === null && result.bodyText
          ? ` (non-JSON body: ${result.bodyText.slice(0, 120).replace(/\s+/g, ' ')})`
          : '';
  return `${label} responded ${status} over ${result.transport}${hint}`;
}
