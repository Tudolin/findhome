/**
 * iCalendar (RFC 5545) output.
 *
 * This is how the agenda reaches Apple Calendar, Google Calendar, Outlook and
 * anything else: not through per-vendor OAuth, but through the one format all of
 * them already speak. Two ways in:
 *
 *   download   a single .ics file — opens straight into the user's calendar app
 *   subscribe  a URL the calendar app polls, so bookings made later appear on
 *              their own without another export
 *
 * Subscription is the one that actually matters for a shared house hunt: your
 * partner books a viewing in the app and it lands on your phone. OAuth into
 * Google and Apple would mean two provider integrations, two consent screens and
 * two sets of tokens to refresh, to end up in the same place.
 *
 * Hand-written rather than a library: the spec surface used here is small, and
 * the fiddly parts (CRLF, 75-octet folding, escaping) are a dozen lines.
 */

export type IcsEvent = {
  /** Stable across edits — the calendar matches on it to update, not duplicate. */
  uid: string;
  start: Date;
  durationMinutes: number;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** Bumped on every edit so clients accept the newer version. */
  sequence?: number;
  /** Minutes before the start to fire a reminder. Omit for none. */
  alarmMinutesBefore?: number | null;
};

/** RFC 5545 §3.3.5: UTC timestamp, "19980118T230000Z". */
function stamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * RFC 5545 §3.3.11: backslash, semicolon and comma are escaped, and a newline
 * becomes a literal "\n". Order matters — the backslash must go first.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: lines are folded at 75 octets, continued with a leading space.
 *
 * Counted in UTF-8 bytes, not characters: "Jardim Paulistânia" is longer on the
 * wire than it looks, and splitting mid-codepoint produces a file Apple Calendar
 * rejects outright.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;
  // 74 for continuation lines, which carry a leading space.
  while (start < bytes.length) {
    const limit = chunks.length === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);

    // Walk back off a UTF-8 continuation byte (10xxxxxx) so a multi-byte
    // character is never cut in half.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;

    chunks.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }

  return chunks.map((chunk, i) => (i === 0 ? chunk : ` ${chunk}`)).join('\r\n');
}

function line(name: string, value: string): string {
  return fold(`${name}:${value}`);
}

export type CalendarOptions = {
  /** Shown as the calendar's name in the subscriber's app. */
  name: string;
  /** Hint for how often a subscribing client should re-poll. */
  refreshMinutes?: number;
};

export function buildCalendar(events: IcsEvent[], options: CalendarOptions): string {
  const now = stamp(new Date());
  const refresh = options.refreshMinutes ?? 60;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    // PRODID must be globally unique per RFC; the domain is illustrative only.
    'PRODID:-//FindHome//Visit Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    line('X-WR-CALNAME', escapeText(options.name)),
    // Apple reads X-PUBLISHED-TTL, Google reads REFRESH-INTERVAL. Both are
    // advisory, and both are ignored by somebody, so send both.
    line('X-PUBLISHED-TTL', `PT${refresh}M`),
    line('REFRESH-INTERVAL;VALUE=DURATION', `PT${refresh}M`),
  ];

  for (const event of events) {
    const end = new Date(event.start.getTime() + Math.max(5, event.durationMinutes) * 60_000);

    lines.push('BEGIN:VEVENT');
    lines.push(line('UID', event.uid));
    lines.push(line('DTSTAMP', now));
    lines.push(line('DTSTART', stamp(event.start)));
    lines.push(line('DTEND', stamp(end)));
    lines.push(line('SEQUENCE', String(event.sequence ?? 0)));
    lines.push(line('SUMMARY', escapeText(event.summary)));
    if (event.description) lines.push(line('DESCRIPTION', escapeText(event.description)));
    if (event.location) lines.push(line('LOCATION', escapeText(event.location)));
    if (event.url) lines.push(line('URL', event.url));

    if (event.alarmMinutesBefore) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(line('TRIGGER', `-PT${event.alarmMinutesBefore}M`));
      lines.push(line('DESCRIPTION', escapeText(event.summary)));
      lines.push('END:VALARM');
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // RFC 5545 §3.1: CRLF, and a trailing one.
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * "Add to Google Calendar" link, for a one-off event.
 *
 * Complements the .ics rather than replacing it: this creates a single event in
 * the browser the user is already signed into, which is the fastest path for one
 * viewing, while the subscription keeps the whole agenda in sync.
 */
export function googleCalendarUrl(event: IcsEvent): string {
  const end = new Date(event.start.getTime() + Math.max(5, event.durationMinutes) * 60_000);
  const compact = (date: Date) => `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.summary,
    dates: `${compact(event.start)}/${compact(end)}`,
    ...(event.description ? { details: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
  });

  return `https://calendar.google.com/calendar/render?${params}`;
}
