import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { handler, notFound, ok } from '@/lib/http';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ body: z.string().trim().min(1).max(2000) });

export const GET = handler(async (req: Request, { params }: Ctx) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const { id: propertyId } = await params;

  const comments = await prisma.propertyComment.findMany({
    where: {
      propertyId,
      scopeKey: ws.scopeKey,
      ...(ws.kind === 'SOLO' ? { userId: ws.userId } : {}),
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return ok({ comments });
});

export const POST = handler(async (req: Request, { params }: Ctx) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const { id: propertyId } = await params;
  const { body } = schema.parse(await req.json());

  const exists = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } });
  if (!exists) throw notFound('Property not found');

  const comment = await prisma.propertyComment.create({
    data: { propertyId, userId: ws.userId, partyId: ws.partyId, scopeKey: ws.scopeKey, body },
    include: { user: { select: { id: true, name: true } } },
  });

  return ok({ comment }, 201);
});
