import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { badRequest, handler, ok } from '@/lib/http';
import { normalizeRecoveryCode } from '@/lib/password';
import { generateRecoveryCodes } from '@/lib/session';
import { requirePassword } from '@/lib/step-up';
import { formatSecret, generateSecret, otpauthUri, verifyTotp } from '@/lib/totp';
import { requireUser } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/**
 * Two-factor setup, in three steps that cannot be short-circuited:
 *
 *   POST   { action: 'begin' }                 -> secret + otpauth URI
 *   POST   { action: 'enable', code, password } -> proves the app works, arms it
 *   DELETE { password }                         -> disarms it
 *
 * ## Why `begin` and `enable` are separate
 *
 * The secret is stored on `begin` but 2FA is **not** in force until
 * `totpEnabledAt` is set, and that only happens once a code generated from that
 * secret has been accepted. Arming it in one step would lock someone out of their
 * own account the first time a QR code was scanned into the wrong app, or a phone
 * clock was wrong — with no email delivery to recover through, that is
 * unrecoverable without a psql prompt.
 */

const enableSchema = z.object({
  action: z.literal('enable'),
  code: z.string().trim().min(6).max(10),
  password: z.string().min(1).max(200),
});

const beginSchema = z.object({ action: z.literal('begin'), password: z.string().min(1).max(200) });

export const POST = handler(async (req: Request) => {
  const session = await requireUser();
  const body = await req.json();
  const action = z.object({ action: z.enum(['begin', 'enable']) }).parse(body).action;

  if (action === 'begin') {
    const { password } = beginSchema.parse(body);
    await requirePassword(session.sub, password);

    // A fresh secret every time `begin` runs. Reusing one that was never
    // confirmed would let an abandoned setup — possibly captured off a screen —
    // stay valid indefinitely.
    const secret = generateSecret();
    await prisma.user.update({
      where: { id: session.sub },
      data: { totpSecret: secret, totpEnabledAt: null, totpLastStep: null },
    });

    return ok({
      secret,
      /** Grouped in fours, for typing into an app that cannot scan. */
      formatted: formatSecret(secret),
      uri: otpauthUri(secret, session.email),
    });
  }

  const { code, password } = enableSchema.parse(body);
  await requirePassword(session.sub, password);

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { totpSecret: true },
  });
  if (!user?.totpSecret) throw badRequest('Comece a configuração antes de confirmar o código.');

  const result = verifyTotp(user.totpSecret, code);
  if (!result.ok) throw badRequest('Código incorreto. Confira o relógio do celular e tente de novo.');

  /**
   * Recovery codes are generated here and shown exactly once.
   *
   * Stored as bcrypt hashes, like passwords — they are password-equivalent, since
   * each one bypasses the second factor. Anyone who loses them regenerates from
   * the security screen; there is deliberately no way to read them back.
   */
  const codes = generateRecoveryCodes();
  // Hashed through the SAME normaliser the verification side uses. Doing it by
  // hand here (`replace('-', '')`) would work today and break silently the day
  // the display format changes.
  const hashes = await Promise.all(codes.map((entry) => hashPassword(normalizeRecoveryCode(entry))));

  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId: session.sub } }),
    prisma.recoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId: session.sub, codeHash })),
    }),
    prisma.user.update({
      where: { id: session.sub },
      data: { totpEnabledAt: new Date(), totpLastStep: result.step },
    }),
  ]);

  return ok({ enabled: true, recoveryCodes: codes });
});

export const DELETE = handler(async (req: Request) => {
  const session = await requireUser();
  const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await req.json());
  await requirePassword(session.sub, password);

  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId: session.sub } }),
    prisma.user.update({
      where: { id: session.sub },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
    }),
  ]);

  return ok({ enabled: false });
});
