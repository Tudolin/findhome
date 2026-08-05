import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { handler, ok } from '@/lib/http';
import { listWorkspaces, requireUser } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const schema = z.object({ name: z.string().trim().min(2).max(80) });

// Ambiguous characters (0/O, 1/I) removed — these codes get read out loud.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateInviteCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

export const GET = handler(async () => {
  const session = await requireUser();
  return ok({ workspaces: await listWorkspaces(session.sub) });
});

export const POST = handler(async (req: Request) => {
  const session = await requireUser();
  const { name } = schema.parse(await req.json());

  // Retry on the astronomically unlikely invite-code collision instead of
  // failing the call.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const party = await prisma.party.create({
        data: {
          name,
          inviteCode: generateInviteCode(),
          createdByUserId: session.sub,
          members: { create: { userId: session.sub, role: 'OWNER' } },
          // A new party starts with no preferences; the profile is created on
          // the first save from /preferences.
        },
      });
      return ok({ party: { id: party.id, name: party.name, inviteCode: party.inviteCode } }, 201);
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }

  throw new Error('Could not allocate a unique invite code');
});
