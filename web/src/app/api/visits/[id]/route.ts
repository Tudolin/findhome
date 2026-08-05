import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { forbidden, handler, notFound, ok } from '@/lib/http';
import { resolveWorkspace, scopeFilter } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  notes: z.string().max(2000).nullish(),
});

/**
 * Confirms the visit belongs to the active workspace.
 *
 * Scope, not ownership: inside a party anyone can move or cancel a viewing,
 * because two people arranging one trip should not be blocked by whoever happened
 * to type it in. Crossing a workspace boundary is still refused.
 */
async function assertInScope(id: string, ws: Awaited<ReturnType<typeof resolveWorkspace>>) {
  const visit = await prisma.visit.findUnique({ where: { id }, select: { id: true, scopeKey: true, userId: true } });
  if (!visit) throw notFound('Visit not found');
  if (visit.scopeKey !== ws.scopeKey) throw forbidden('That visit belongs to another workspace');
  // In Solo Mode every user shares the scopeKey "solo", so the user id has to be
  // checked too or personal agendas would be visible across accounts.
  if (ws.kind === 'SOLO' && visit.userId !== ws.userId) throw forbidden('That visit belongs to another workspace');
  return visit;
}

export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const { id } = await params;
  await assertInScope(id, ws);

  const input = schema.parse(await req.json());

  const visit = await prisma.visit.update({
    where: { id },
    data: {
      ...(input.scheduledAt ? { scheduledAt: new Date(input.scheduledAt) } : {}),
      ...(input.durationMin ? { durationMin: input.durationMin } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
    },
    include: { user: { select: { id: true, name: true } } },
  });

  return ok({ visit });
});

export const DELETE = handler(async (req: Request, { params }: Ctx) => {
  const url = new URL(req.url);
  const ws = await resolveWorkspace(url.searchParams.get('workspace'));
  const { id } = await params;
  await assertInScope(id, ws);

  await prisma.visit.delete({ where: { id } });

  // The interaction status is deliberately left alone. "We looked at this one"
  // stays true after a cancellation, and silently rewinding it would lose the
  // rating and notes' context.
  const remaining = await prisma.visit.count({ where: { ...scopeFilter(ws) } });
  return ok({ ok: true, remaining });
});
