'use client';

import { useState } from 'react';
import Link from 'next/link';
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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    const res = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? t.auth.genericError);
      setPending(false);
      return;
    }

    // Full navigation so the server components pick up the new cookie.
    // Only same-origin relative paths — never redirect to an attacker-supplied
    // absolute URL from ?next=.
    window.location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
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
          minLength={mode === 'register' ? 8 : 1}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
        {mode === 'register' && <p className="mt-1.5 text-xs text-ink-500">{t.auth.passwordHint}</p>}
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

      <button type="submit" className="btn-primary w-full !py-3" disabled={pending}>
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
