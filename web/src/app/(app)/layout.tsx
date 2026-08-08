import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { getPreferenceProfile } from '@/lib/queries';
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

  /**
   * First run goes through the wizard.
   *
   * Without a profile the feed has nothing to filter by and the scraper has
   * nothing to search for, so a new account landed on an empty Discovery page —
   * which is where most people conclude the app is broken. The absence of the
   * profile row IS the "not onboarded yet" flag; finishing the wizard writes it
   * and this check stops firing. No extra column, no way to get out of step.
   *
   * Checked here rather than in middleware because it needs the database, which
   * the Edge runtime cannot reach. `/onboarding` sits OUTSIDE this route group, so
   * this layout never runs for it and the redirect cannot loop.
   */
  if (!(await getPreferenceProfile(active))) redirect('/onboarding');

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
