/**
 * Password policy.
 *
 * The old rule was `min(8)` and nothing else, which on a LAN was defensible. On
 * the public internet it is not: eight characters of anything is the shape of
 * every password in every credential-stuffing list.
 *
 * ## Length over composition
 *
 * No "must contain a symbol" rule here, deliberately. Composition rules push
 * people to `Senha@123` — which satisfies every class and is in the first
 * thousand guesses — while a passphrase that would take centuries gets rejected
 * for having no digit. NIST dropped composition requirements in SP 800-63B for
 * exactly this reason. What is enforced instead is length, and refusing the
 * passwords that are actually guessed first.
 *
 * ## What this is not
 *
 * It is not zxcvbn, and it does not pretend to be. The blocklist below is short
 * and Brazil-flavoured because that is where the users are. It catches the
 * bottom of the distribution; the length floor does the rest. Pairing it with the
 * lockout in the login route is what makes online guessing hopeless regardless.
 */

/** Floor, in characters. */
export const MIN_LENGTH = 12;
/** bcrypt silently truncates at 72 bytes; refusing longer is honest. */
export const MAX_LENGTH = 200;

/**
 * The passwords that are tried first. Not a dictionary — a dictionary belongs in
 * a library — but the specific strings a Brazilian household actually reaches for
 * plus the universal top of every leak list.
 */
const BLOCKED = [
  '123456', '1234567', '12345678', '123456789', '1234567890', '12345',
  'password', 'senha', 'senha123', 'minhasenha', 'admin', 'administrador',
  'qwerty', 'qwertyui', 'abc123', 'abcd1234', 'iloveyou', 'welcome',
  'findhome', 'findhome123', 'apartamento', 'imovel', 'aluguel', 'casa123',
  'brasil', 'brasil123', 'flamengo', 'corinthians', 'palmeiras', 'saopaulo',
  'temporaria', 'mudar123', 'trocar123', 'novasenha', 'password1', 'senha1234',
];

export type PasswordVerdict =
  | { ok: true; warnings: string[] }
  | { ok: false; reason: string };

/** Three or more of the same character, or a straight run up or down the keyboard. */
function looksMechanical(value: string): boolean {
  if (/(.)\1{3,}/.test(value)) return true;

  let ascending = 1;
  let descending = 1;
  for (let i = 1; i < value.length; i += 1) {
    const step = value.charCodeAt(i) - value.charCodeAt(i - 1);
    ascending = step === 1 ? ascending + 1 : 1;
    descending = step === -1 ? descending + 1 : 1;
    if (ascending >= 5 || descending >= 5) return true;
  }
  return false;
}

/** Distinct characters as a share of length. `aaaaaaaaaaaa` is 12 long and useless. */
const variety = (value: string) => new Set(value).size;

/**
 * Judges a candidate password.
 *
 * `email` and `name` are compared against because a password built from the
 * account it protects is the first thing anyone tries, and it is the one case
 * where the app knows the answer in advance.
 */
export function assessPassword(
  password: string,
  context: { email?: string; name?: string } = {},
): PasswordVerdict {
  if (password.length < MIN_LENGTH) {
    return { ok: false, reason: `A senha precisa de pelo menos ${MIN_LENGTH} caracteres.` };
  }
  if (password.length > MAX_LENGTH) {
    return { ok: false, reason: `A senha não pode passar de ${MAX_LENGTH} caracteres.` };
  }
  if (password.trim().length !== password.length) {
    // Not pedantry: a trailing space pasted from a manager is invisible and the
    // login then fails forever with no explanation.
    return { ok: false, reason: 'A senha não pode começar nem terminar com espaço.' };
  }

  const folded = password.toLowerCase();

  if (BLOCKED.some((entry) => folded === entry || folded.includes(entry))) {
    return { ok: false, reason: 'Essa senha está entre as mais tentadas. Escolha outra.' };
  }

  if (looksMechanical(password)) {
    return { ok: false, reason: 'Sequências e repetições (1234, aaaa) são tentadas primeiro.' };
  }

  if (variety(password) < 6) {
    return { ok: false, reason: 'Use mais caracteres diferentes — o comprimento sozinho não basta.' };
  }

  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && folded.includes(local)) {
    return { ok: false, reason: 'A senha não pode conter o seu e-mail.' };
  }

  const firstName = context.name?.trim().split(/\s+/)[0]?.toLowerCase();
  if (firstName && firstName.length >= 4 && folded.includes(firstName)) {
    return { ok: false, reason: 'A senha não pode conter o seu nome.' };
  }

  // Accepted, but worth saying. A warning never blocks — a long passphrase of
  // lower-case words is genuinely strong, and refusing it would be the
  // composition-rule mistake this module exists to avoid.
  const warnings: string[] = [];
  if (password.length < 16 && !/\d/.test(password)) {
    warnings.push('Senhas curtas ficam bem mais fortes com um número ou símbolo.');
  }
  if (password.length >= 20) warnings.push('Boa — comprimento é o que mais importa.');

  return { ok: true, warnings };
}

/**
 * Rough entropy, for the strength bar only.
 *
 * Deliberately crude — `log2(pool) * length` overestimates for anything
 * memorable, which is why it is never used to *accept* a password, only to draw
 * a bar that moves as you type. The accept/reject decision is `assessPassword`.
 */
export function passwordScore(password: string): number {
  if (!password) return 0;
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/\d/.test(password)) pool += 10;
  if (/[^\w\s]/.test(password)) pool += 32;
  if (/\s/.test(password)) pool += 1;
  const bits = Math.log2(Math.max(pool, 2)) * password.length;
  return Math.max(0, Math.min(100, Math.round((bits / 90) * 100)));
}

/**
 * Alphabet for recovery codes: base32 minus the glyphs that are misread off
 * paper. No `O`/`0`, no `I`/`1` — those are how a recovery code stops working on
 * the one day it is needed.
 *
 * The generator itself is in ./auth, because it must draw from a CSPRNG and this
 * module is imported by the client-side strength meter.
 */
export const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Normalises a typed recovery code so case and the dash do not matter. */
export const normalizeRecoveryCode = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '');
