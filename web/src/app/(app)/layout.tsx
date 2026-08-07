import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
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

  // The shell wraps the content rather than sitting above it: the left padding
  // has to follow the rail's collapsed state, and that is client state.
  return (
    <AppShell
      user={{ name: session.name, email: session.email }}
      workspaces={workspaces}
      activeId={active.partyId ?? 'solo'}
      theme={theme}
    >
      {children}
    </AppShell>
  );
}
