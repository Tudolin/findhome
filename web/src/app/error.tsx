'use client';

import { useEffect } from 'react';

/**
 * Route-level error boundary. The most likely cause on a home server is the
 * database being unreachable (container restarting, disk full), so the copy
 * points at that rather than showing a raw stack trace.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[findhome] render error', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="card max-w-lg p-10 text-center">
        <p className="text-4xl">⚠️</p>
        <h1 className="mt-4 text-lg font-black text-ink-900">Something broke</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-500">
          Usually the database container is restarting. Check{' '}
          <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-700 shadow-neu-inset-sm">
            docker compose ps
          </code>{' '}
          and{' '}
          <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-700 shadow-neu-inset-sm">
            docker compose logs web
          </code>
          .
        </p>
        {error.digest && <p className="mt-3 font-mono text-[11px] text-ink-400">digest: {error.digest}</p>}
        <button type="button" onClick={reset} className="btn-primary mt-6">
          Try again
        </button>
      </div>
    </main>
  );
}
