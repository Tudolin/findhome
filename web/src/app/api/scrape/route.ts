import { z } from 'zod';
import { ApiError, handler, ok } from '@/lib/http';
import { getLastScrapeRuns } from '@/lib/queries';
import { requireUser } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/**
 * Manual scrape trigger.
 *
 *   GET  /api/scrape   scheduler state + the last run per source
 *   POST /api/scrape   start a run now, optionally for specific sources
 *
 * The scraper's own control API is not published to the LAN (see
 * docker-compose.yml), so this route is the only way in and it requires a
 * signed-in user. The shared secret travels server-to-server over the private
 * bridge network and is never sent to the browser.
 */

const CONTROL_URL = process.env.SCRAPER_CONTROL_URL ?? 'http://scraper:8080';
const CONTROL_TOKEN = process.env.SCRAPE_CONTROL_TOKEN ?? '';

/** Long enough for a slow container, short enough not to hang a page. */
const TIMEOUT_MS = 10_000;

const body = z.object({
  sources: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

type ControlHealth = {
  ok?: boolean;
  running?: boolean;
  sources?: string[];
  cron?: string;
  timezone?: string;
};

async function callControl(path: string, init: RequestInit = {}): Promise<{ status: number; data: unknown }> {
  try {
    const response = await fetch(`${CONTROL_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(CONTROL_TOKEN ? { 'x-scrape-token': CONTROL_TOKEN } : {}),
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  } catch (err) {
    // A missing or stopped scraper container lands here. Say which, rather than
    // letting it surface as a generic 500.
    const reason = (err as Error).name === 'TimeoutError' ? 'timed out' : (err as Error).message;
    throw new ApiError(503, `The scraper service is unreachable at ${CONTROL_URL} (${reason})`);
  }
}

export const GET = handler(async () => {
  await requireUser();

  const [runs, health] = await Promise.all([
    getLastScrapeRuns(),
    // A dead scraper should not blank out the run history the dashboard needs.
    callControl('/health')
      .then((r) => r.data as ControlHealth)
      .catch(() => null),
  ]);

  return ok({
    runs,
    scheduler: health
      ? {
          reachable: true,
          running: health.running ?? false,
          sources: health.sources ?? [],
          cron: health.cron ?? null,
          timezone: health.timezone ?? null,
        }
      : { reachable: false, running: false, sources: [], cron: null, timezone: null },
  });
});

export const POST = handler(async (req: Request) => {
  await requireUser();
  const input = body.parse(await req.json().catch(() => ({})));

  const { status, data } = await callControl('/run', {
    method: 'POST',
    body: JSON.stringify(input.sources?.length ? { sources: input.sources } : {}),
  });

  if (status === 202) {
    const started = data as { sources?: string[] };
    return ok({ started: true, sources: started.sources ?? [] }, 202);
  }

  const error = (data as { error?: string }).error ?? `The scraper refused the request (${status})`;
  // 409 = already running, 401 = token mismatch, 400 = unknown source name.
  throw new ApiError(status === 401 ? 500 : status, status === 401 ? 'Scraper rejected the control token' : error);
});
