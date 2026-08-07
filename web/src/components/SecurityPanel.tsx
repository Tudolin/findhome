'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { assessPassword, passwordScore } from '@/lib/password';
import { useT } from './LocaleProvider';

export type SessionRow = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

export type AttemptRow = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  success: boolean;
  reason: string | null;
  createdAt: string;
};

/**
 * The account's security screen: two-factor, devices, password, activity.
 *
 * Every action here re-asks for the password. That is not belt-and-braces
 * paranoia — the threat is an unlocked laptop, and without it thirty seconds at a
 * signed-in browser is enough to turn off 2FA, sign the owner's phone out and
 * change the password, which locks them out of their own account permanently. See
 * lib/step-up.ts.
 */
export default function SecurityPanel({
  email,
  twoFactorEnabled,
  recoveryCodesLeft,
  passwordChangedAt,
  lockoutThreshold,
  lockoutMinutes,
  sessions,
  attempts,
  title,
}: {
  email: string;
  twoFactorEnabled: boolean;
  recoveryCodesLeft: number;
  passwordChangedAt: string | null;
  lockoutThreshold: number;
  lockoutMinutes: number;
  sessions: SessionRow[];
  attempts: AttemptRow[];
  title: string;
}) {
  const t = useT();
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** 2FA enrolment, held only until the code is confirmed. */
  const [setup, setSetup] = useState<{ secret: string; formatted: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);

  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const verdict = newPassword ? assessPassword(newPassword, { email }) : null;
  const strength = passwordScore(newPassword);

  async function call(url: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.auth.genericError);
      return data as Record<string, unknown>;
    } finally {
      setBusy(false);
    }
  }

  const fail = (err: unknown) => setError((err as Error).message);
  /** The password box is emptied after every action — it is never kept around. */
  const done = (message: string) => {
    setPassword('');
    setNotice(message);
    router.refresh();
  };

  async function begin() {
    try {
      const data = await call('/api/auth/2fa', 'POST', { action: 'begin', password });
      setSetup({ secret: String(data.secret), formatted: String(data.formatted), uri: String(data.uri) });
      setCodes(null);
    } catch (err) {
      fail(err);
    }
  }

  async function enable() {
    try {
      const data = await call('/api/auth/2fa', 'POST', { action: 'enable', code, password });
      setCodes((data.recoveryCodes as string[]) ?? []);
      setSetup(null);
      setCode('');
      done(t.security.twoFactorOn);
    } catch (err) {
      fail(err);
    }
  }

  async function disable() {
    if (!window.confirm(t.security.confirmDisable)) return;
    try {
      await call('/api/auth/2fa', 'DELETE', { password });
      setCodes(null);
      done(t.security.twoFactorOff);
    } catch (err) {
      fail(err);
    }
  }

  async function revoke(sessionId: string) {
    try {
      await call('/api/auth/sessions', 'DELETE', { password, sessionId });
      done(t.security.deviceSignedOut);
    } catch (err) {
      fail(err);
    }
  }

  async function revokeAll() {
    if (!window.confirm(t.security.confirmSignOutAll)) return;
    try {
      const data = await call('/api/auth/sessions', 'DELETE', { password, all: true });
      done(t.security.othersSignedOut(Number(data.revoked ?? 0)));
    } catch (err) {
      fail(err);
    }
  }

  async function changePassword() {
    try {
      const data = await call('/api/auth/password', 'PUT', {
        currentPassword: password,
        newPassword,
        keepThisDevice: true,
      });
      setNewPassword('');
      done(t.security.passwordChanged(Number(data.otherSessionsSignedOut ?? 0)));
    } catch (err) {
      fail(err);
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-ink-900">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-500">{t.security.subtitle}</p>
      </div>

      {/* One password box for the whole screen. Every action below reads it. */}
      <div className="card p-6">
        <label className="label" htmlFor="stepup">
          {t.security.confirmPassword}
        </label>
        <input
          id="stepup"
          type="password"
          className="input max-w-sm"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
        />
        <p className="mt-1.5 text-xs text-ink-500">{t.security.confirmPasswordHint}</p>

        {error && (
          <p className="well-sm mt-4 px-4 py-3 text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="well-sm mt-4 px-4 py-3 text-sm font-medium text-brand-700" role="status">
            {notice}
          </p>
        )}
      </div>

      {/* --- Two-factor -------------------------------------------------- */}
      <section className="card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink-800">{t.security.twoFactor}</h2>
            <p className="mt-1 text-xs text-ink-500">{t.security.twoFactorHint}</p>
          </div>
          <span className={clsx('chip', twoFactorEnabled ? 'tint-pro' : 'tint-con')}>
            {twoFactorEnabled ? t.security.on : t.security.off}
          </span>
        </div>

        {twoFactorEnabled ? (
          <div className="space-y-3">
            {/* Running out of recovery codes on a self-hosted app with no email
                delivery is how an account becomes unrecoverable. Worth nagging. */}
            <p
              className={clsx(
                'well-sm px-4 py-3 text-xs',
                recoveryCodesLeft <= 2 ? 'text-warning' : 'text-ink-600',
              )}
            >
              {t.security.recoveryLeft(recoveryCodesLeft)}
            </p>
            <button type="button" className="btn-ghost" disabled={busy || !password} onClick={disable}>
              {t.security.disable2fa}
            </button>
          </div>
        ) : setup ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-600">{t.security.scanHint}</p>

            {/* The URI, not a rendered QR. Generating a QR needs a dependency, and
                every authenticator app accepts a pasted otpauth:// link or a typed
                secret — so this avoids the dependency without losing the flow. */}
            <div className="well space-y-3 p-4">
              <div>
                <p className="label !mb-1">{t.security.secret}</p>
                <code className="block break-all font-mono text-sm tracking-widest text-ink-800">
                  {setup.formatted}
                </code>
              </div>
              <div>
                <p className="label !mb-1">{t.security.otpauthUri}</p>
                <code className="block break-all text-[11px] text-ink-500">{setup.uri}</code>
              </div>
            </div>

            <div className="max-w-xs">
              <label className="label" htmlFor="confirm-code">
                {t.security.enterCode}
              </label>
              <input
                id="confirm-code"
                className="input text-center font-mono text-xl tracking-[0.3em]"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || code.length < 6 || !password}
                onClick={enable}
              >
                {t.security.confirmEnable}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setSetup(null)}>
                {t.common.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-primary" disabled={busy || !password} onClick={begin}>
            {t.security.enable2fa}
          </button>
        )}

        {/* Shown exactly once. There is deliberately no way to read them back. */}
        {codes && codes.length > 0 && (
          <div className="well mt-5 p-4">
            <p className="text-sm font-bold text-warning">{t.security.saveCodes}</p>
            <p className="mt-1 text-xs text-ink-500">{t.security.saveCodesHint}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {codes.map((entry) => (
                <code key={entry} className="rounded-lg bg-surface px-2 py-1.5 text-center font-mono text-xs shadow-neu-inset-sm">
                  {entry}
                </code>
              ))}
            </div>
            <button
              type="button"
              className="btn-ghost mt-3 !py-2"
              onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}
            >
              {t.visits.copy}
            </button>
          </div>
        )}
      </section>

      {/* --- Devices ----------------------------------------------------- */}
      <section className="card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink-800">{t.security.devices}</h2>
            <p className="mt-1 text-xs text-ink-500">{t.security.devicesHint}</p>
          </div>
          <button type="button" className="btn-ghost !py-2" disabled={busy || !password} onClick={revokeAll}>
            {t.security.signOutOthers}
          </button>
        </div>

        <ul className="space-y-2">
          {sessions.map((row) => (
            <li key={row.id} className="well-sm flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-800">
                  {row.userAgent ?? t.security.unknownDevice}
                  {row.current && <span className="ml-2 chip tint-pro !py-0.5 !text-[10px]">{t.security.thisDevice}</span>}
                </p>
                <p className="text-xs text-ink-500">
                  {row.ip ?? '—'} · {t.security.lastUsed(when(row.lastSeenAt))}
                </p>
              </div>
              {!row.current && (
                <button
                  type="button"
                  className="btn-ghost !py-1.5 !text-xs"
                  disabled={busy || !password}
                  onClick={() => revoke(row.id)}
                >
                  {t.security.signOut}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* --- Password ---------------------------------------------------- */}
      <section className="card p-6">
        <h2 className="text-sm font-bold text-ink-800">{t.security.changePassword}</h2>
        <p className="mt-1 text-xs text-ink-500">
          {passwordChangedAt ? t.security.lastChanged(when(passwordChangedAt)) : t.security.neverChanged}
        </p>

        <div className="mt-4 max-w-sm">
          <label className="label" htmlFor="newpw">
            {t.security.newPassword}
          </label>
          <input
            id="newpw"
            type="password"
            className="input"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={clsx(
                'h-full rounded-full transition-all duration-300',
                strength < 40 ? 'bg-danger' : strength < 70 ? 'bg-warning' : 'bg-brand-500',
              )}
              style={{ width: `${Math.max(4, strength)}%` }}
            />
          </div>
          <p className={clsx('mt-1.5 text-xs', verdict && !verdict.ok ? 'text-warning' : 'text-ink-500')}>
            {verdict && !verdict.ok ? verdict.reason : t.auth.passwordHint}
          </p>
        </div>

        <button
          type="button"
          className="btn-primary mt-4"
          disabled={busy || !password || !newPassword || (verdict !== null && !verdict.ok)}
          onClick={changePassword}
        >
          {t.security.changePassword}
        </button>
        <p className="mt-2 text-xs text-ink-500">{t.security.changeSignsOut}</p>
      </section>

      {/* --- Activity ---------------------------------------------------- */}
      <section className="card p-6">
        <h2 className="text-sm font-bold text-ink-800">{t.security.activity}</h2>
        <p className="mt-1 text-xs text-ink-500">{t.security.activityHint(lockoutThreshold, lockoutMinutes)}</p>

        <ul className="mt-4 space-y-1.5">
          {attempts.length === 0 && <li className="text-sm text-ink-400">{t.security.noActivity}</li>}
          {attempts.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className={clsx('font-semibold', row.success ? 'text-brand-700' : 'text-danger')}>
                {row.success ? t.security.succeeded : t.security.failed}
                {row.reason && <span className="ml-1.5 font-normal opacity-70">({row.reason})</span>}
              </span>
              <span className="text-ink-500">
                {row.ip ?? '—'} · {when(row.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
