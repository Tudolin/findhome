import { z } from 'zod';
import { handler, ok } from '@/lib/http';
import { getFeed, type FeedSort } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const query = z.object({
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'score', 'sqm_desc']).default('newest'),
  q: z.string().trim().max(120).optional(),
  status: z
    .enum(['ALL', 'UNREVIEWED', 'DISCOVERED', 'INTERESTED', 'FAVORITE', 'VISIT_SCHEDULED', 'APPLIED', 'REJECTED'])
    .default('ALL'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(24),
  ignorePreferences: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const params = query.parse(Object.fromEntries(url.searchParams));

  const feed = await getFeed(ws, { ...params, sort: params.sort as FeedSort });

  return ok({
    workspace: { kind: ws.kind, id: ws.partyId ?? 'solo', name: ws.name, members: ws.members },
    ...feed,
  });
});
