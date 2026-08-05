'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';

export type WorkspaceOption = {
  id: string;
  kind: 'SOLO' | 'PARTY';
  name: string;
  memberCount: number;
  inviteCode: string | null;
};

const NAV = [
  { href: '/dashboard', label: 'Discovery' },
  { href: '/co-op', label: 'Co-Op Hub' },
  { href: '/preferences', label: 'Preferences' },
];

export default function TopBar({
  user,
  workspaces,
  activeId,
}: {
  user: { name: string; email: string };
  workspaces: WorkspaceOption[];
  activeId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  async function switchWorkspace(workspaceId: string) {
    setOpen(false);
    if (workspaceId === activeId) return;
    await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    });
    // The active workspace changes every server query, so refresh the tree.
    startTransition(() => router.refresh());
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-400 text-sm font-black text-brand-950 shadow-neu-brand">
            FH
          </span>
          <span className="hidden text-base font-bold tracking-tight text-ink-800 sm:inline">FindHome</span>
        </Link>

        {/* Workspace switcher */}
        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={clsx('btn-ghost max-w-[15rem] !py-2', open && 'shadow-neu-inset-sm', pending && 'opacity-60')}
          >
            <span
              className={clsx(
                'h-2 w-2 shrink-0 rounded-full',
                active?.kind === 'PARTY' ? 'bg-brand-500' : 'bg-ink-400',
              )}
            />
            <span className="truncate">{active?.name ?? 'Personal Search'}</span>
            <span className="text-ink-400">▾</span>
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute left-0 z-20 mt-2 w-72 overflow-hidden rounded-2xl bg-surface p-2 shadow-neu-lg">
                <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-500">Workspaces</p>
                <div className="space-y-1.5">
                  {workspaces.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => switchWorkspace(w.id)}
                      className={clsx(
                        'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-150',
                        w.id === activeId
                          ? 'bg-surface text-brand-800 shadow-neu-inset-sm'
                          : 'bg-surface text-ink-700 shadow-neu-sm hover:text-ink-900',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{w.name}</span>
                        <span className="block text-xs font-normal text-ink-500">
                          {w.kind === 'SOLO' ? 'Solo mode' : `Party · ${w.memberCount} members`}
                        </span>
                      </span>
                      {w.id === activeId && <span className="text-brand-600">✓</span>}
                    </button>
                  ))}
                </div>
                <Link
                  href="/co-op#party"
                  onClick={() => setOpen(false)}
                  className="mt-2 block rounded-xl px-3 py-2.5 text-sm font-semibold text-brand-700 shadow-neu-sm hover:text-brand-800"
                >
                  + Create or join a party
                </Link>
              </div>
            </>
          )}
        </div>

        <nav className="ml-2 hidden items-center gap-2 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-150 ease-neu',
                pathname.startsWith(item.href)
                  ? 'bg-surface text-brand-800 shadow-neu-inset-sm'
                  : 'bg-surface text-ink-600 shadow-neu-sm hover:text-ink-900',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className="hidden text-sm font-medium text-ink-600 sm:inline">{user.name}</span>
          <button type="button" onClick={signOut} className="btn-ghost !py-2 whitespace-nowrap">
            Sign out
          </button>
        </div>
      </div>

      <nav className="flex gap-2 px-4 pb-3 md:hidden">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'flex-1 rounded-xl px-2 py-2 text-center text-xs font-semibold transition-all',
              pathname.startsWith(item.href)
                ? 'bg-surface text-brand-800 shadow-neu-inset-sm'
                : 'bg-surface text-ink-600 shadow-neu-sm',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
