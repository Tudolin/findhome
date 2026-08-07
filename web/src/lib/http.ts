import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/** Thrown by handlers to short-circuit with a specific status code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new ApiError(401, 'Not authenticated');
export const forbidden = (msg = 'You do not have access to this workspace') => new ApiError(403, msg);
export const notFound = (msg = 'Not found') => new ApiError(404, msg);
export const badRequest = (msg: string) => new ApiError(400, msg);
export const conflict = (msg: string) => new ApiError(409, msg);

/**
 * 429, with the Retry-After the client is expected to honour.
 *
 * Carries the header on the error itself because `handler()` is what turns an
 * ApiError into a Response, and a 429 without Retry-After tells a well-behaved
 * client nothing about when to come back.
 */
export class RateLimitedError extends ApiError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, 'Too many attempts. Please wait and try again.');
  }
}

export const tooManyRequests = (retryAfterSeconds: number) => new RateLimitedError(retryAfterSeconds);

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Methods that change something and therefore need the origin check below. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Refuses a state-changing request that came from another site.
 *
 * ## Why this exists on top of SameSite=Lax
 *
 * `SameSite=Lax` already withholds the session cookie from cross-site POSTs, and
 * every mutation here sends `content-type: application/json`, which a form cannot
 * produce and which therefore forces a CORS preflight the browser will refuse. So
 * this is the third layer, not the first.
 *
 * It is worth having anyway because the other two are properties of the *client*.
 * A browser with a relaxed default, an old WebView, an extension, or a future
 * route that accepts a form encoding would quietly remove them. An Origin check
 * is a property of the server, and it fails closed.
 *
 * Requests with no Origin header are allowed: `curl`, the health probe and
 * server-to-server callers send none, and they are not the attack — CSRF needs a
 * browser, and a browser always sends Origin on a cross-site mutation.
 */
export function assertSameOrigin(req: Request): void {
  if (!MUTATING.has(req.method.toUpperCase())) return;

  const origin = req.headers.get('origin');
  if (!origin) return;

  const allowed = new Set<string>();
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) allowed.add(configured.replace(/\/$/, ''));

  // The host the request actually arrived on, so a LAN address or a tunnel
  // hostname works without APP_ORIGIN having to be set for every one of them.
  const host = req.headers.get('host');
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }

  if (!allowed.has(origin.replace(/\/$/, ''))) {
    throw new ApiError(403, 'Cross-origin request refused');
  }
}

/**
 * Wraps a route handler so thrown ApiError/ZodError become clean JSON
 * responses instead of 500s with stack traces.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      /**
       * Every route goes through `handler`, so putting the check here means a new
       * endpoint cannot forget it.
       *
       * Read through `unknown[]` rather than destructuring `args`: a handler
       * written as `handler(async () => …)` infers `Args` as the empty tuple, and
       * indexing that is a compile error — even though Next.js passes the Request
       * at runtime regardless of the declared arity. `/api/auth/logout` is exactly
       * that shape and is a POST, so getting this wrong would have left the one
       * route CSRF most wants unguarded.
       */
      const request = (args as unknown[])[0];
      if (request instanceof Request) assertSameOrigin(request);

      return await fn(...args);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        return NextResponse.json(
          { error: err.message, retryAfter: err.retryAfterSeconds },
          { status: 429, headers: { 'retry-after': String(err.retryAfterSeconds) } },
        );
      }
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
          { status: 422 },
        );
      }
      console.error('[api] unhandled error', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}
