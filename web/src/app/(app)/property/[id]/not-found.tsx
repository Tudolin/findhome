import Link from 'next/link';

export default function PropertyNotFound() {
  return (
    <div className="card mx-auto max-w-lg p-12 text-center">
      <p className="text-4xl">🏚️</p>
      <h1 className="mt-4 text-lg font-black text-ink-900">This listing is gone</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-500">
        It was either removed from the source portal and cleaned up, or the link is wrong.
      </p>
      <Link href="/dashboard" className="btn-primary mt-6">
        Back to discovery
      </Link>
    </div>
  );
}
