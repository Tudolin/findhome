'use client';

/**
 * A visit's date and time, rendered in the READER's timezone.
 *
 * A client component for one string because the alternative is wrong: the server
 * stores UTC and has no reliable idea where the reader is, so formatting there
 * would show a viewing an hour off for anyone whose device disagrees with the
 * container's TZ. `undefined` as the locale means "use this device's settings",
 * which is also what makes the format itself familiar (24h here, AM/PM there).
 */
export default function VisitTime({ iso }: { iso: string }) {
  return (
    <>
      {new Date(iso).toLocaleString(undefined, {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </>
  );
}
