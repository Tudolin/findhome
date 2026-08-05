import { handler, notFound, ok } from '@/lib/http';
import { getPropertyDetail } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, { params }: Ctx) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const { id } = await params;

  const property = await getPropertyDetail(ws, id);
  if (!property) throw notFound('Property not found');

  return ok({ workspace: { kind: ws.kind, id: ws.partyId ?? 'solo', name: ws.name, members: ws.members }, property });
});
