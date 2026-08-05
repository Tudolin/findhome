import { cookies } from 'next/headers';
import { z } from 'zod';
import { WORKSPACE_COOKIE } from '@/lib/auth';
import { handler, ok } from '@/lib/http';
import { assertPartyMembership, listWorkspaces, requireUser, SOLO_SCOPE } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const schema = z.object({ workspaceId: z.string().min(1) });

/** Workspaces available in the top-bar switcher. */
export const GET = handler(async () => {
  const session = await requireUser();
  return ok({ workspaces: await listWorkspaces(session.sub) });
});

/** Switch the active workspace (Solo <-> a Party). */
export const POST = handler(async (req: Request) => {
  const session = await requireUser();
  const { workspaceId } = schema.parse(await req.json());

  if (workspaceId !== SOLO_SCOPE) {
    // Throws 403 if the user is not a member — you cannot switch into a party
    // by guessing its id.
    await assertPartyMembership(session.sub, workspaceId);
  }

  const store = await cookies();
  store.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  });

  return ok({ activeWorkspace: workspaceId });
});
