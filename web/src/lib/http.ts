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

/**
 * Wraps a route handler so thrown ApiError/ZodError become clean JSON
 * responses instead of 500s with stack traces.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
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
