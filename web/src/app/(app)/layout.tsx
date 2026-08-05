import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import TopBar from '@/components/TopBar';
import { listWorkspaces, resolveWorkspace } from '@/lib/workspace';
import { getSession } from '@/lib/auth';
import { isTheme, THEME_COOKIE, type Theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const [workspaces, active, store] = await Promise.all([
    listWorkspaces(session.sub),
    resolveWorkspace(),
    cookies(),
  ]);

  const stored = store.get(THEME_COOKIE)?.value;
  const theme: Theme = isTheme(stored) ? stored : 'system';

  return (
    <div className="min-h-screen">
      <TopBar
        user={{ name: session.name, email: session.email }}
        workspaces={workspaces}
        activeId={active.partyId ?? 'solo'}
        theme={theme}
      />
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
