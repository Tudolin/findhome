import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { WORKSPACE_COOKIE } from '@/lib/auth';
import { forbidden, handler, ok } from '@/lib/http';
import { assertPartyMembership, requireUser, SOLO_SCOPE } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const session = await requireUser();
  const { id } = await params;
  const membership = await assertPartyMembership(session.sub, id);

  return ok({
    party: {
      id: membership.party.id,
      name: membership.party.name,
      inviteCode: membership.party.inviteCode,
      createdAt: membership.party.createdAt,
      role: membership.role,
      members: membership.party.members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    },
  });
});

/** Leave a party. The last OWNER cannot leave without deleting the party. */
export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const session = await requireUser();
  const { id } = await params;
  const membership = await assertPartyMembership(session.sub, id);

  const owners = membership.party.members.filter((m) => m.role === 'OWNER');
  if (membership.role === 'OWNER' && owners.length === 1 && membership.party.members.length > 1) {
    throw forbidden('Promote another member to owner before leaving');
  }

  if (membership.party.members.length === 1) {
    // Last member out deletes the party (cascades to preferences,
    // interactions and comments).
    await prisma.party.delete({ where: { id } });
  } else {
    await prisma.partyMember.delete({ where: { partyId_userId: { partyId: id, userId: session.sub } } });
  }

  const store = await cookies();
  if (store.get(WORKSPACE_COOKIE)?.value === id) {
    store.set(WORKSPACE_COOKIE, SOLO_SCOPE, { httpOnly: true, sameSite: 'lax', path: '/' });
  }

  return ok({ ok: true });
});
