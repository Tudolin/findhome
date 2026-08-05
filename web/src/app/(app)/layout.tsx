import { redirect } from 'next/navigation';
import TopBar from '@/components/TopBar';
import { listWorkspaces, resolveWorkspace } from '@/lib/workspace';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const [workspaces, active] = await Promise.all([listWorkspaces(session.sub), resolveWorkspace()]);

  return (
    <div className="min-h-screen">
      <TopBar
        user={{ name: session.name, email: session.email }}
        workspaces={workspaces}
        activeId={active.partyId ?? 'solo'}
      />
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
