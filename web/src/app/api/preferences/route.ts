import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { badRequest, handler, ok } from '@/lib/http';
import { dedupeBySlug, displayName, locationSlug, toUf } from '@/lib/locations';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const schema = z.object({
  city: z.string().trim().min(2).max(80),
  /** Accepts a UF or a full state name; stored as a UF. Empty means "no state". */
  state: z.string().trim().max(40).nullish(),
  neighborhoods: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  listingType: z.enum(['RENT', 'SALE']).default('RENT'),
  minPrice: z.number().int().min(0).max(10_000_000).nullable().default(null),
  maxPrice: z.number().int().min(0).max(10_000_000).nullable().default(null),
  includeCondoInMaxPrice: z.boolean().default(true),
  minBedrooms: z.number().int().min(0).max(10).default(0),
  minBathrooms: z.number().int().min(0).max(10).default(0),
  minParkingSpots: z.number().int().min(0).max(10).default(0),
  minSqm: z.number().int().min(0).max(2000).default(0),
  petFriendly: z.boolean().default(false),
  amenities: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
});

/** Preferences for the ACTIVE workspace (personal profile or shared party profile). */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));

  const profile = await prisma.preferenceProfile.findFirst({
    where: ws.kind === 'SOLO' ? { userId: ws.userId } : { partyId: ws.partyId! },
  });

  return ok({ workspace: { kind: ws.kind, id: ws.partyId ?? 'solo', name: ws.name }, profile });
});

export const PUT = handler(async (req: Request) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const input = schema.parse(await req.json());

  if (input.minPrice != null && input.maxPrice != null && input.minPrice > input.maxPrice) {
    [input.minPrice, input.maxPrice] = [input.maxPrice, input.minPrice];
  }

  // Canonicalisation happens here and only here. The client sends what the user
  // typed; the slug columns the scraper and the feed filter both depend on are
  // derived server-side, so no client can write a city whose slug disagrees with
  // its name.
  const city = displayName(input.city, 80);
  const citySlug = locationSlug(city);
  if (!citySlug) throw badRequest('City must contain at least one letter or digit');

  const state = input.state ? toUf(input.state) : null;
  if (input.state && !state) throw badRequest(`"${input.state}" is not a Brazilian state or state code`);

  // Folds "Vila Mariana" / "vila mariana" / "VILA MARIANA" into one entry.
  const neighborhoods = dedupeBySlug(input.neighborhoods);

  const data = {
    ...input,
    city,
    citySlug,
    state,
    neighborhoods,
    neighborhoodSlugs: neighborhoods.map(locationSlug),
  };

  const owner = ws.kind === 'SOLO' ? { userId: ws.userId } : { partyId: ws.partyId! };

  // upsert() needs a unique where; userId and partyId are each @unique on the
  // profile, so the two branches are both single-row targets.
  const profile =
    ws.kind === 'SOLO'
      ? await prisma.preferenceProfile.upsert({
          where: { userId: ws.userId },
          update: data,
          create: { ...data, ...owner },
        })
      : await prisma.preferenceProfile.upsert({
          where: { partyId: ws.partyId! },
          update: data,
          create: { ...data, ...owner },
        });

  return ok({ profile });
});
