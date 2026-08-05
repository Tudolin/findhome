import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { badRequest, handler, notFound, ok } from '@/lib/http';
import { resolveWorkspace, scopeFilter } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const schema = z.object({
  propertyId: z.string().min(1),
  /** ISO 8601 from the browser, which supplies the offset — stored as UTC. */
  scheduledAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(5).max(480).default(30),
  notes: z.string().max(2000).nullish(),
});

/** Every visit for the active workspace, soonest first. */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));

  const visits = await prisma.visit.findMany({
    where: scopeFilter(ws),
    orderBy: { scheduledAt: 'asc' },
    include: {
      user: { select: { id: true, name: true } },
      property: { select: { id: true, title: true, address: true, neighborhood: true, city: true, sourceUrl: true } },
    },
  });

  return ok({ visits });
});

export const POST = handler(async (req: Request) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const input = schema.parse(await req.json());

  const property = await prisma.property.findUnique({ where: { id: input.propertyId }, select: { id: true } });
  if (!property) throw notFound('Property not found');

  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw badRequest('scheduledAt is not a valid date');

  const visit = await prisma.visit.create({
    data: {
      propertyId: input.propertyId,
      userId: ws.userId,
      partyId: ws.partyId,
      scopeKey: ws.scopeKey,
      scheduledAt,
      durationMin: input.durationMin,
      notes: input.notes ?? null,
    },
    include: { user: { select: { id: true, name: true } } },
  });

  // Booking a viewing says something about the listing's progress, so the status
  // follows along — but only forward. Someone who already sent an application
  // should not be walked back to "visit scheduled" by adding a second viewing.
  const existing = await prisma.propertyInteraction.findUnique({
    where: {
      propertyId_userId_scopeKey: { propertyId: input.propertyId, userId: ws.userId, scopeKey: ws.scopeKey },
    },
    select: { status: true },
  });

  if (existing?.status !== 'APPLIED' && existing?.status !== 'REJECTED') {
    await prisma.propertyInteraction.upsert({
      where: {
        propertyId_userId_scopeKey: { propertyId: input.propertyId, userId: ws.userId, scopeKey: ws.scopeKey },
      },
      update: { status: 'VISIT_SCHEDULED' },
      create: {
        propertyId: input.propertyId,
        userId: ws.userId,
        partyId: ws.partyId,
        scopeKey: ws.scopeKey,
        status: 'VISIT_SCHEDULED',
      },
    });
  }

  return ok({ visit }, 201);
});
