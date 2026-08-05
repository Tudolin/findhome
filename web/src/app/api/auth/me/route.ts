import { handler, ok } from '@/lib/http';
import { listWorkspaces, requireUser, resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await requireUser();
  const [workspaces, active] = await Promise.all([listWorkspaces(session.sub), resolveWorkspace()]);

  return ok({
    user: { id: session.sub, name: session.name, email: session.email },
    workspaces,
    activeWorkspace: { id: active.partyId ?? 'solo', kind: active.kind, name: active.name, members: active.members },
  });
});
