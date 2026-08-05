import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="card max-w-md p-12 text-center">
        <p className="text-4xl font-black text-brand-600">404</p>
        <h1 className="mt-3 text-lg font-black text-ink-900">Page not found</h1>
        <p className="mt-2 text-sm text-ink-500">That route does not exist in FindHome.</p>
        <Link href="/dashboard" className="btn-primary mt-6">
          Go to discovery
        </Link>
      </div>
    </main>
  );
}
