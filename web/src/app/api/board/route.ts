import { handler, ok } from '@/lib/http';
import { getBoard } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/** Ranked Kanban payload for /co-op. */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const cards = await getBoard(ws);

  return ok({
    workspace: { kind: ws.kind, id: ws.partyId ?? 'solo', name: ws.name, members: ws.members },
    cards,
  });
});
