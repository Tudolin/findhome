import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { PropertySource } from '@prisma/client';
import { config } from './config.js';
import { logger } from './logger.js';
import { parseSources } from './config.js';
import { getLastSummary, isRunning, runScrape } from './runner.js';

const log = logger('control');

/**
 * Control API for triggering a run by hand, so "scrape now" does not mean
 * "SSH to the server and remember the container name".
 *
 *   GET  /health   liveness + whether a run is in progress
 *   GET  /status   the last run's per-source outcome
 *   POST /run      start a run; optional {"sources": ["ZAP"]} body
 *
 * The port is deliberately NOT published in docker-compose.yml: this listens
 * only on the private `findhome` network, where the web container reaches it as
 * http://scraper:8080. SCRAPE_CONTROL_TOKEN adds a shared secret on top.
 */

type Json = Record<string, unknown>;

function send(res: ServerResponse, status: number, body: Json): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** Constant-time compare, so the token cannot be guessed a character at a time. */
function tokenMatches(provided: string): boolean {
  const expected = config.controlToken;
  if (!expected) return true;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage, limit = 4096): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(buffer);
  }

  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as Json;
  } catch {
    throw new Error('Request body is not valid JSON');
  }
}

/**
 * Resolves the sources for a manual run. An explicit list is validated against
 * the same allow-list as SCRAPE_SOURCES, so a typo is a 400 rather than a run
 * that quietly scrapes nothing.
 */
function resolveSources(body: Json): PropertySource[] {
  const requested = body.sources;
  if (requested === undefined || requested === null) return config.sources;

  const list = Array.isArray(requested) ? requested : String(requested).split(',');
  const cleaned = list.map((s) => String(s).trim()).filter(Boolean);
  if (cleaned.length === 0) return config.sources;

  return parseSources(cleaned.join(','));
}

function summaryPayload() {
  const summary = getLastSummary();
  if (!summary) return null;
  return {
    startedAt: summary.startedAt.toISOString(),
    finishedAt: summary.finishedAt.toISOString(),
    durationMs: summary.durationMs,
    targets: summary.targets,
    outcomes: summary.outcomes,
  };
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://scraper');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && (path === '/health' || path === '/')) {
    send(res, 200, {
      ok: true,
      running: isRunning(),
      sources: config.sources,
      cron: config.cron,
      timezone: config.timezone,
      maxPages: config.maxPages,
      pageSize: config.pageSize,
    });
    return;
  }

  // Everything below this line mutates or reveals run detail.
  const provided = String(req.headers['x-scrape-token'] ?? '');
  if (!tokenMatches(provided)) {
    send(res, 401, { error: 'Invalid or missing x-scrape-token' });
    return;
  }

  if (req.method === 'GET' && path === '/status') {
    send(res, 200, { running: isRunning(), lastRun: summaryPayload() });
    return;
  }

  if (req.method === 'POST' && path === '/run') {
    if (isRunning()) {
      send(res, 409, { error: 'A scrape run is already in progress', running: true });
      return;
    }

    let sources: PropertySource[];
    try {
      sources = resolveSources(await readBody(req));
    } catch (err) {
      send(res, 400, { error: (err as Error).message });
      return;
    }

    // Answer immediately and let the run continue in the background: a full
    // pass takes minutes and no caller should hold a socket open for it.
    // Progress is followed through ScrapeRun rows and GET /status.
    log.info(`manual run requested · sources=${sources.join(', ')}`);
    void runScrape(sources).catch((err) => log.error('manual run crashed', err));

    send(res, 202, { started: true, sources });
    return;
  }

  send(res, 404, { error: `No route for ${req.method} ${path}` });
}

export function startControlServer(): Server | null {
  if (!config.controlEnabled) {
    log.info('control API disabled (SCRAPE_CONTROL_ENABLED=false)');
    return null;
  }

  const server = createServer((req, res) => {
    void route(req, res).catch((err) => {
      log.error('control request failed', err);
      if (!res.headersSent) send(res, 500, { error: 'Internal error' });
    });
  });

  server.listen(config.controlPort, '0.0.0.0', () => {
    log.info(`control API listening on :${config.controlPort} (POST /run to scrape now)`);
    if (!config.controlToken) {
      log.warn('SCRAPE_CONTROL_TOKEN is not set — any container on the findhome network can trigger a run');
    }
  });

  server.on('error', (err) => log.error('control API error', err));

  return server;
}
