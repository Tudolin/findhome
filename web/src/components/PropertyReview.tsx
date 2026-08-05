'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { InteractionStatus } from '@prisma/client';
import { clearInteraction, updateInteraction } from '@/lib/client';
import type { UiInteraction, UiWorkspace } from '@/lib/types';
import ProsConsEditor from './ProsConsEditor';
import StarRating from './StarRating';
import StatusChip from './StatusChip';
import StatusPicker from './StatusPicker';

/**
 * The current user's own review of a property, plus a read-only column per
 * other party member — the "side-by-side pros & cons" view.
 */
export default function PropertyReview({
  propertyId,
  mine,
  others,
  workspace,
}: {
  propertyId: string;
  mine: UiInteraction | null;
  others: UiInteraction[];
  workspace: UiWorkspace;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<InteractionStatus | null>(mine?.status ?? null);
  const [rating, setRating] = useState<number | null>(mine?.rating ?? null);
  const [pros, setPros] = useState<string[]>(mine?.pros ?? []);
  const [cons, setCons] = useState<string[]>(mine?.cons ?? []);
  const [notes, setNotes] = useState(mine?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function persist(patch: Parameters<typeof updateInteraction>[1]) {
    setBusy(true);
    setError(null);
    try {
      await updateInteraction(propertyId, patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await clearInteraction(propertyId);
      setStatus(null);
      setRating(null);
      setPros([]);
      setCons([]);
      setNotes('');
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink-800">Your review</h2>
          <div className="flex items-center gap-2">
            {saved && <span className="chip tint-pro !text-[10px]">Saved ✓</span>}
            {mine && (
              <button type="button" className="btn-ghost !py-1.5 !text-xs" onClick={remove} disabled={busy}>
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="mb-5">
          <p className="label">Status</p>
          <StatusPicker
            value={status}
            disabled={busy}
            onChange={(s) => {
              setStatus(s);
              void persist({ status: s });
            }}
          />
        </div>

        <div className="mb-6">
          <p className="label">Your rating</p>
          <StarRating
            value={rating}
            onChange={(r) => {
              setRating(r);
              void persist({ rating: r });
            }}
          />
        </div>

        <ProsConsEditor
          pros={pros}
          cons={cons}
          disabled={busy}
          onChange={(next) => {
            setPros(next.pros);
            setCons(next.cons);
            void persist(next);
          }}
        />

        <div className="mt-6">
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            className="input min-h-[88px] resize-y"
            placeholder="Anything you want to remember about this place…"
            maxLength={4000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if ((mine?.notes ?? '') !== notes) void persist({ notes: notes || null });
            }}
          />
          <p className="mt-1.5 text-xs text-ink-500">
            {workspace.kind === 'PARTY'
              ? 'Visible to your party. Use the thread for back-and-forth.'
              : 'Saved to your solo workspace.'}
          </p>
        </div>

        {error && <p className="mt-4 text-sm font-medium text-rose-700">{error}</p>}
      </div>

      {workspace.kind === 'PARTY' && (
        <div className="card p-6">
          <h2 className="mb-4 text-sm font-bold text-ink-800">Side by side</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {workspace.members.map((member) => {
              const it =
                member.userId === workspace.userId ? mine : (others.find((o) => o.userId === member.userId) ?? null);
              const isMe = member.userId === workspace.userId;
              return (
                <div key={member.userId} className={clsx('rounded-xl bg-surface p-4', isMe ? 'shadow-neu-sm' : 'shadow-neu-inset-sm')}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className={clsx('text-sm font-bold', isMe ? 'text-brand-800' : 'text-ink-700')}>
                      {isMe ? 'You' : member.name}
                    </span>
                    {it ? (
                      <StatusChip status={it.status} size="sm" />
                    ) : (
                      <span className="chip !text-[10px] text-ink-400">no input yet</span>
                    )}
                  </div>

                  <StarRating value={it?.rating ?? null} readOnly size="sm" />

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {it?.pros.map((p) => (
                      <span key={p} className="chip tint-pro !px-2.5 !py-0.5 !text-[10px]">
                        ✓ {p}
                      </span>
                    ))}
                    {it?.cons.map((c) => (
                      <span key={c} className="chip tint-con !px-2.5 !py-0.5 !text-[10px]">
                        ✕ {c}
                      </span>
                    ))}
                    {!it?.pros.length && !it?.cons.length && (
                      <span className="text-xs text-ink-400">No pros or cons listed.</span>
                    )}
                  </div>

                  {it?.notes && (
                    <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-ink-600">{it.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
