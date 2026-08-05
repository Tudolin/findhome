export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-400 text-lg font-black text-brand-950 shadow-neu-brand">
            FH
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-800">FindHome</h1>
          <p className="mt-1 text-sm text-ink-500">Self-hosted apartment hunting, together.</p>
        </div>
        <div className="card p-7">{children}</div>
        <p className="mt-6 text-center text-xs text-ink-400">Running on your own server. No accounts anywhere else.</p>
      </div>
    </main>
  );
}
