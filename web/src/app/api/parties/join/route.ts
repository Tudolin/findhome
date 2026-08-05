import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { conflict, handler, notFound, ok } from '@/lib/http';
import { requireUser } from '@/lib/workspace';

const schema = z.object({ inviteCode: z.string().trim().toUpperCase().min(4).max(16) });

export const POST = handler(async (req: Request) => {
  const session = await requireUser();
  const { inviteCode } = schema.parse(await req.json());

  const party = await prisma.party.findUnique({
    where: { inviteCode },
    include: { _count: { select: { members: true } } },
  });
  if (!party) throw notFound('No party found for that invite code');

  const already = await prisma.partyMember.findUnique({
    where: { partyId_userId: { partyId: party.id, userId: session.sub } },
  });
  if (already) throw conflict('You are already a member of this party');

  const maxMembers = Number(process.env.MAX_PARTY_MEMBERS ?? 6);
  if (party._count.members >= maxMembers) throw conflict(`This party is full (${maxMembers} members)`);

  await prisma.partyMember.create({
    data: { partyId: party.id, userId: session.sub, role: 'MEMBER' },
  });

  return ok({ party: { id: party.id, name: party.name } }, 201);
});
