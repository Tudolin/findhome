'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { postComment } from '@/lib/client';
import { relativeDate } from '@/lib/format';

export type ThreadComment = {
  id: string;
  body: string;
  createdAt: string | Date;
  user: { id: string; name: string };
};

export default function CommentThread({
  propertyId,
  comments,
  currentUserId,
  isParty,
}: {
  propertyId: string;
  comments: ThreadComment[];
  currentUserId: string;
  isParty: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postComment(propertyId, body.trim());
      setBody('');
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="mb-1.5 text-sm font-bold text-ink-800">
        {isParty ? 'Shared activity & notes' : 'Your notes log'}
      </h2>
      <p className="mb-4 text-xs text-ink-500">
        {isParty
          ? 'Visit impressions, landlord replies, questions for your partner — everyone in the party sees this.'
          : 'A running log for this listing. Private to your solo workspace.'}
      </p>

      <ul className="mb-4 space-y-3">
        {comments.map((c) => {
          const mine = c.user.id === currentUserId;
          return (
            <li
              key={c.id}
              className={clsx('rounded-xl bg-surface px-4 py-3', mine ? 'shadow-neu-sm' : 'shadow-neu-inset-sm')}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className={clsx('text-xs font-bold', mine ? 'text-brand-800' : 'text-ink-700')}>
                  {mine ? 'You' : c.user.name}
                </span>
                <span className="text-[11px] text-ink-400">{relativeDate(c.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{c.body}</p>
            </li>
          );
        })}
        {comments.length === 0 && (
          <li className="rounded-xl px-4 py-6 text-center text-sm text-ink-400">No messages yet.</li>
        )}
      </ul>

      <form onSubmit={submit} className="space-y-3">
        <textarea
          className="input min-h-[84px] resize-y"
          placeholder={isParty ? 'Write something for the party…' : 'Add a note…'}
          aria-label="New message"
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy || !body.trim()}>
            {busy ? 'Posting…' : 'Post'}
          </button>
          {error && <span className="text-sm font-medium text-danger">{error}</span>}
        </div>
      </form>
    </div>
  );
}
