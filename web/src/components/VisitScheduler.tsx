'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from './LocaleProvider';

/** 30 minutes is what an agent usually books; the rest cover a longer look. */
const DURATIONS = [15, 30, 45, 60, 90];

/**
 * Books a viewing.
 *
 * The datetime-local input is read as LOCAL time and converted with
 * `toISOString()`, so the offset is applied by the browser that knows the user's
 * zone. The server stores UTC and never guesses a timezone — which matters
 * because the scraper's TZ and the user's phone are not necessarily the same.
 */
export default function VisitScheduler({ propertyId, compact = false }: { propertyId: string; compact?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!when) return;

    const scheduledAt = new Date(when);
    if (Number.isNaN(scheduledAt.getTime())) return setError(t.visits.pastDate);
    // A viewing in the past is almost always a typo in the date field.
    if (scheduledAt.getTime() < Date.now() - 60_000) return setError(t.visits.pastDate);

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/visits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          scheduledAt: scheduledAt.toISOString(),
          durationMin: duration,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);

      setOpen(false);
      setWhen('');
      setNotes('');
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={compact ? 'btn-ghost !py-2' : 'btn-ghost'}>
        📅 {compact ? t.visits.scheduleShort : t.visits.schedule}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="well space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">{t.visits.when}</span>
          <input
            type="datetime-local"
            className="input"
            required
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </label>
        <label>
          <span className="label">{t.visits.duration}</span>
          <select className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {t.visits.minutes(d)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="label">{t.visits.notes}</span>
        <input
          className="input"
          placeholder={t.visits.notesPlaceholder}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {error && <p className="text-xs font-medium text-danger">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy || !when}>
          {busy ? t.visits.saving : t.visits.save}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
