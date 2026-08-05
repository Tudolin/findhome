'use client';

import { useState } from 'react';
import { createParty, joinParty, leaveParty, switchWorkspace } from '@/lib/client';

type ActiveParty = {
  id: string;
  name: string;
  inviteCode: string;
  members: Array<{ name: string; role: string }>;
};

export default function PartyPanel({ activeParty }: { activeParty: ActiveParty | null }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  async function run(fn: () => Promise<{ party: { id: string } }>) {
    setBusy(true);
    setError(null);
    try {
      const { party } = await fn();
      await switchWorkspace(party.id);
      window.location.href = '/co-op';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function copy(kind: 'code' | 'link') {
    if (!activeParty) return;
    const text =
      kind === 'code' ? activeParty.inviteCode : `${window.location.origin}/register?invite=${activeParty.inviteCode}`;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  async function onLeave() {
    if (!activeParty) return;
    setBusy(true);
    setError(null);
    try {
      await leaveParty(activeParty.id);
      await switchWorkspace('solo');
      window.location.href = '/dashboard';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setConfirmLeave(false);
    }
  }

  const isLastMember = activeParty?.members.length === 1;

  return (
    <div id="party" className="grid gap-5 md:grid-cols-2">
      {activeParty && (
        <div className="card p-6 md:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-ink-800">{activeParty.name}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeParty.members.map((m) => (
                  <span key={m.name} className="chip-raised">
                    {m.name}
                    <span className="text-[10px] uppercase tracking-wider text-ink-400">{m.role.toLowerCase()}</span>
                  </span>
                ))}
              </div>
            </div>

            {confirmLeave ? (
              <div className="well-sm flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="text-xs font-semibold text-ink-700">
                  {isLastMember ? 'You are the last member — this deletes the party.' : 'Leave this party?'}
                </span>
                <button type="button" className="btn-danger !py-1.5 !text-xs" disabled={busy} onClick={onLeave}>
                  {busy ? 'Leaving…' : isLastMember ? 'Delete it' : 'Yes, leave'}
                </button>
                <button
                  type="button"
                  className="btn-ghost !py-1.5 !text-xs"
                  disabled={busy}
                  onClick={() => setConfirmLeave(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="btn-ghost !py-1.5 !text-xs" onClick={() => setConfirmLeave(true)}>
                Leave party
              </button>
            )}
          </div>

          <div className="well mt-5 p-4">
            <p className="label !mb-3">Invite code</p>
            <div className="flex flex-wrap items-center gap-3">
              <code className="rounded-xl bg-surface px-5 py-3 font-mono text-lg font-bold tracking-[0.3em] text-brand-800 shadow-neu-sm">
                {activeParty.inviteCode}
              </code>
              <button type="button" className="btn-ghost" onClick={() => copy('code')}>
                {copied === 'code' ? 'Copied ✓' : 'Copy code'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => copy('link')}>
                {copied === 'link' ? 'Copied ✓' : 'Copy invite link'}
              </button>
            </div>
            <p className="mt-3 text-xs text-ink-500">
              The link drops your partner straight into registration with the code filled in. Or they can paste the
              code into “Join a party”.
            </p>
          </div>
        </div>
      )}

      <div className="card p-6">
        <h2 className="mb-1.5 text-sm font-bold text-ink-800">Create a party</h2>
        <p className="mb-4 text-xs text-ink-500">
          A shared workspace with its own preferences, board and notes. Your solo search stays untouched.
        </p>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="e.g. Alex &amp; Sam — Mudança 2026"
            aria-label="Party name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={busy || name.trim().length < 2}
            onClick={() => run(() => createParty(name.trim()))}
          >
            Create
          </button>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="mb-1.5 text-sm font-bold text-ink-800">Join a party</h2>
        <p className="mb-4 text-xs text-ink-500">Enter the invite code someone shared with you.</p>
        <div className="flex gap-2">
          <input
            className="input font-mono uppercase tracking-widest"
            placeholder="ABCD2345"
            aria-label="Invite code"
            value={code}
            maxLength={16}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={busy || code.trim().length < 4}
            onClick={() => run(() => joinParty(code.trim()))}
          >
            Join
          </button>
        </div>
      </div>

      {error && (
        <p className="well-sm px-4 py-3 text-sm font-medium text-rose-700 md:col-span-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
