'use client';

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { assessPassword, MIN_LENGTH, passwordScore } from '@/lib/password';
import { useT } from './LocaleProvider';

type Mode = 'login' | 'register';

/**
 * `invite` and `next` are passed down from the page's server-side
 * `searchParams` rather than read with useSearchParams(): that hook opts the
 * subtree into client-side rendering, which meant the prefilled invite code
 * was missing from the server HTML and only appeared after hydration.
 */
export default function AuthForm({
  mode,
  invite = '',
  next = '',
}: {
  mode: Mode;
  invite?: string;
  next?: string;
}) {
  // PartyPanel shares links of the form /register?invite=CODE — prefill from
  // it so the recipient never has to retype the code.
  const t = useT();
  const invitedCode = invite.toUpperCase();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  /**
   * Set once the password is accepted and the account has a second factor. Holding
   * it flips the form to the code step — the password is never kept, and the
   * challenge expires in five minutes on the server whatever the browser does.
   */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  /** Only same-origin relative paths — never an attacker-supplied absolute URL. */
  const destination = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  // Full navigation, so the server components pick up the new cookie.
  const land = () => {
    window.location.href = destination;
  };

  const strength = mode === 'register' ? passwordScore(password) : 0;
  const verdict = mode === 'register' && password ? assessPassword(password) : null;

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? t.auth.genericError);
    return data as Record<string, unknown>;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      const data = await post(`/api/auth/${mode}`, payload);

      // Password was right, but the account has 2FA. No cookie has been set.
      if (data.needsTotp && typeof data.challenge === 'string') {
        setChallenge(data.challenge);
        setPending(false);
        return;
      }

      land();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await post('/api/auth/totp', { challenge, code });
      land();
    } catch (err) {
      setError((err as Error).message);
      setCode('');
      setPending(false);
    }
  }

  /** ------------------------------------------------------------------ */
  /** Step two: the code.                                                  */
  /** ------------------------------------------------------------------ */
  if (challenge) {
    return (
      <form onSubmit={onVerify} className="space-y-5">
        <div>
          <label className="label" htmlFor="code">
            {t.auth.totpTitle}
          </label>
          <input
            id="code"
            name="code"
            className="input text-center font-mono text-2xl tracking-[0.4em]"
            // `one-time-code` is what makes iOS and Android offer the code from
            // the SMS/authenticator sheet instead of the password manager.
            autoComplete="one-time-code"
            inputMode="numeric"
            autoFocus
            required
            maxLength={20}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-ink-500">{t.auth.totpHint}</p>
        </div>

        {error && (
          <p className="well-sm px-4 py-3 text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary w-full !py-3" disabled={pending || code.length < 6}>
          {pending ? t.auth.submitting : t.auth.totpVerify}
        </button>

        <button
          type="button"
          className="btn-ghost w-full"
          onClick={() => {
            setChallenge(null);
            setCode('');
            setError(null);
          }}
        >
          {t.auth.totpBack}
        </button>
      </form>
    );
  }

  const registerHref = invitedCode ? `/register?invite=${invitedCode}` : '/register';

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {mode === 'register' && invitedCode && (
        <p className="well-sm px-4 py-3 text-xs text-ink-600">
          {t.auth.invitedTo}{' '}
          <strong className="font-mono font-bold tracking-widest text-brand-700">{invitedCode}</strong>{' '}
          {t.auth.invitedRest}
        </p>
      )}

      {mode === 'register' && (
        <div>
          <label className="label" htmlFor="name">
            {t.auth.name}
          </label>
          <input id="name" name="name" className="input" required minLength={2} autoComplete="name" />
        </div>
      )}

      <div>
        <label className="label" htmlFor="email">
          {t.auth.email}
        </label>
        <input id="email" name="email" type="email" className="input" required autoComplete="email" />
      </div>

      <div>
        <label className="label" htmlFor="password">
          {t.auth.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          required
          minLength={mode === 'register' ? MIN_LENGTH : 1}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={mode === 'register' ? password : undefined}
          onChange={mode === 'register' ? (e) => setPassword(e.target.value) : undefined}
        />

        {/* Live feedback, using the SAME function the server validates with, so
            the form can never accept something the API then rejects. */}
        {mode === 'register' && (
          <>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              aria-valuenow={strength}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t.auth.passwordStrength}
            >
              <div
                className={clsx(
                  'h-full rounded-full transition-all duration-300',
                  strength < 40 ? 'bg-danger' : strength < 70 ? 'bg-warning' : 'bg-brand-500',
                )}
                style={{ width: `${Math.max(4, strength)}%` }}
              />
            </div>
            <p
              className={clsx(
                'mt-1.5 text-xs',
                verdict && !verdict.ok ? 'text-warning' : 'text-ink-500',
              )}
            >
              {verdict && !verdict.ok ? verdict.reason : t.auth.passwordHint}
            </p>
          </>
        )}
      </div>

      {mode === 'register' && (
        <div>
          <label className="label" htmlFor="inviteCode">
            {t.auth.inviteCode}{' '}
            <span className="font-normal normal-case tracking-normal text-ink-400">{t.auth.optional}</span>
          </label>
          <input
            id="inviteCode"
            name="inviteCode"
            className="input font-mono uppercase tracking-widest"
            placeholder="e.g. DEMO2026"
            maxLength={16}
            defaultValue={invitedCode}
          />
          <p className="mt-1.5 text-xs text-ink-500">
            {t.auth.inviteHint}
          </p>
        </div>
      )}

      {error && (
        <p className="well-sm px-4 py-3 text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="btn-primary w-full !py-3"
        // Blocked on the client's own verdict, so a rejected password is caught
        // before a round trip. The server checks again regardless — this is
        // convenience, not the control.
        disabled={pending || (mode === 'register' && verdict !== null && !verdict.ok)}
      >
        {pending ? t.auth.submitting : mode === 'login' ? t.auth.signIn : t.auth.register}
      </button>

      <p className="text-center text-sm text-ink-500">
        {mode === 'login' ? (
          <>
            {t.auth.noAccount}{' '}
            <Link href={registerHref} className="font-semibold text-brand-700 hover:text-brand-800">
              {t.auth.register}
            </Link>
          </>
        ) : (
          <>
            {t.auth.haveAccount}{' '}
            <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-800">
              {t.auth.signIn}
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
