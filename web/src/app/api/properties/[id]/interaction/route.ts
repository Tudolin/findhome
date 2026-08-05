import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { handler, notFound, ok } from '@/lib/http';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  status: z.enum(['DISCOVERED', 'INTERESTED', 'FAVORITE', 'VISIT_SCHEDULED', 'APPLIED', 'REJECTED']).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  pinned: z.boolean().optional(),
  pros: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  cons: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

/**
 * Upserts the CURRENT user's interaction with a property inside the active
 * workspace. Party members never overwrite each other: each one owns exactly
 * one row per (property, party), which is what makes side-by-side pros/cons
 * and the ranking engine possible.
 */
export const PUT = handler(async (req: Request, { params }: Ctx) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const { id: propertyId } = await params;
  const patch = schema.parse(await req.json());

  const exists = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } });
  if (!exists) throw notFound('Property not found');

  const interaction = await prisma.propertyInteraction.upsert({
    where: {
      propertyId_userId_scopeKey: { propertyId, userId: ws.userId, scopeKey: ws.scopeKey },
    },
    update: patch,
    create: {
      propertyId,
      userId: ws.userId,
      partyId: ws.partyId,
      scopeKey: ws.scopeKey,
      // Pinning alone must not imply interest: a pin is "keep this in front of
      // me while I decide", so it leaves the status at DISCOVERED unless the
      // caller also set one.
      status: patch.status ?? (patch.pinned ? 'DISCOVERED' : 'INTERESTED'),
      rating: patch.rating ?? null,
      pinned: patch.pinned ?? false,
      pros: patch.pros ?? [],
      cons: patch.cons ?? [],
      notes: patch.notes ?? null,
    },
    include: { user: { select: { id: true, name: true } } },
  });

  return ok({ interaction });
});

/** Removes the user's interaction, pushing the property back into discovery. */
export const DELETE = handler(async (req: Request, { params }: Ctx) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const { id: propertyId } = await params;

  await prisma.propertyInteraction
    .delete({
      where: { propertyId_userId_scopeKey: { propertyId, userId: ws.userId, scopeKey: ws.scopeKey } },
    })
    .catch(() => null);

  return ok({ ok: true });
});
