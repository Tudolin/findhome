import { cookies } from 'next/headers';
import type { PartyRole } from '@prisma/client';
import { prisma } from './prisma';
import { getSession, WORKSPACE_COOKIE, type SessionPayload } from './auth';
import { forbidden, unauthorized } from './http';

export const SOLO_SCOPE = 'solo';

export type WorkspaceMember = {
  userId: string;
  name: string;
  email: string;
  role: PartyRole;
};

export type Workspace = {
  kind: 'SOLO' | 'PARTY';
  /** Value written to PropertyInteraction.scopeKey / PropertyComment.scopeKey. */
  scopeKey: string;
  /** Always the signed-in user. */
  userId: string;
  /** Null in Solo Mode. */
  partyId: string | null;
  name: string;
  members: WorkspaceMember[];
};

export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw unauthorized();
  return session;
}

/**
 * Confirms the user actually belongs to the party. Every read and write in the
 * API funnels through here — it is the single enforcement point for workspace
 * isolation, so a leaked party id is not enough to see another party's data.
 */
export async function assertPartyMembership(userId: string, partyId: string) {
  const membership = await prisma.partyMember.findUnique({
    where: { partyId_userId: { partyId, userId } },
    include: {
      party: {
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { joinedAt: 'asc' },
          },
        },
      },
    },
  });
  if (!membership) throw forbidden();
  return membership;
}

function soloWorkspace(session: SessionPayload): Workspace {
  return {
    kind: 'SOLO',
    scopeKey: SOLO_SCOPE,
    userId: session.sub,
    partyId: null,
    name: 'Personal Search',
    members: [{ userId: session.sub, name: session.name, email: session.email, role: 'OWNER' }],
  };
}

/**
 * Resolves the active workspace.
 *
 * Precedence: explicit `override` (e.g. `?workspace=` on an API call)
 *             > the `fh_workspace` cookie set by the workspace switcher
 *             > Solo Mode.
 *
 * A cookie pointing at a party the user has since left silently falls back to
 * Solo instead of erroring, so a stale browser cannot lock someone out.
 */
export async function resolveWorkspace(override?: string | null): Promise<Workspace> {
  const session = await requireUser();
  const store = await cookies();
  const requested = override ?? store.get(WORKSPACE_COOKIE)?.value ?? SOLO_SCOPE;

  if (!requested || requested === SOLO_SCOPE) return soloWorkspace(session);

  const membership = await prisma.partyMember
    .findUnique({
      where: { partyId_userId: { partyId: requested, userId: session.sub } },
      include: {
        party: {
          include: {
            members: {
              include: { user: { select: { id: true, name: true, email: true } } },
              orderBy: { joinedAt: 'asc' },
            },
          },
        },
      },
    })
    .catch(() => null);

  if (!membership) {
    // Explicit override for a party you are not in is an error; a stale cookie
    // is not.
    if (override) throw forbidden();
    return soloWorkspace(session);
  }

  return {
    kind: 'PARTY',
    scopeKey: membership.partyId,
    userId: session.sub,
    partyId: membership.partyId,
    name: membership.party.name,
    members: membership.party.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })),
  };
}

/** Lists every workspace the user can switch to, for the top-bar switcher. */
export async function listWorkspaces(userId: string) {
  const memberships = await prisma.partyMember.findMany({
    where: { userId },
    include: {
      party: {
        include: {
          _count: { select: { members: true } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return [
    { id: SOLO_SCOPE, kind: 'SOLO' as const, name: 'Personal Search', memberCount: 1, inviteCode: null },
    ...memberships.map((m) => ({
      id: m.partyId,
      kind: 'PARTY' as const,
      name: m.party.name,
      memberCount: m.party._count.members,
      inviteCode: m.party.inviteCode,
      role: m.role,
    })),
  ];
}

/** Prisma `where` fragment that scopes any interaction/comment query. */
export function scopeFilter(ws: Workspace) {
  return ws.kind === 'SOLO'
    ? { scopeKey: SOLO_SCOPE, userId: ws.userId }
    : { scopeKey: ws.scopeKey };
}
