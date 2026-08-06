import { z } from 'zod';
import { handler, ok } from '@/lib/http';
import { FEED_SORTS } from '@/lib/feed-params';
import { getFeed, type FeedSort } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/** `?source=OLX&source=ZAP` and `?source=OLX,ZAP` are both accepted. */
const csv = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    (Array.isArray(v) ? v : v === undefined ? [] : [v])
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter(Boolean),
  );

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const count = z.coerce.number().int().min(1).max(1_000_000).optional();

const query = z.object({
  sort: z.enum(FEED_SORTS).default('newest'),
  q: z.string().trim().max(120).optional(),
  status: z
    .enum([
      'ALL',
      'UNREVIEWED',
      'REVIEWED',
      'DISCOVERED',
      'INTERESTED',
      'FAVORITE',
      'VISIT_SCHEDULED',
      'APPLIED',
      'REJECTED',
    ])
    .default('ALL'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(24),
  ignorePreferences: bool,

  sources: csv,
  neighborhoods: csv,
  amenities: csv,
  minPrice: count,
  maxPrice: count,
  minBedrooms: count,
  maxBedrooms: count,
  minBathrooms: count,
  minParking: count,
  minSqm: count,
  maxSqm: count,
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  petFriendly: z.enum(['yes', 'no']).optional(),
  withPhotos: bool,
  newWithinDays: count,
  ratedOnly: bool,
  pinnedOnly: bool,
  listingType: z.enum(['RENT', 'SALE']).optional(),
});

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  // `getAll` so repeated parameters survive — Object.fromEntries keeps only the
  // last value of each, which would silently collapse every multi-select filter.
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }
  const { petFriendly, ...params } = query.parse(raw);

  const feed = await getFeed(ws, {
    ...params,
    sort: params.sort as FeedSort,
    petFriendly: petFriendly === 'yes' ? true : petFriendly === 'no' ? false : undefined,
  });

  return ok({
    workspace: { kind: ws.kind, id: ws.partyId ?? 'solo', name: ws.name, members: ws.members },
    ...feed,
  });
});
