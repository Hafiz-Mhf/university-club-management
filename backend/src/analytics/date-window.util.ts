const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

// Non-numeric/non-positive silently defaults to 30 — this is a reporting
// window, not a security-sensitive filter, so a bad value degrading to the
// default (rather than 400ing) is the right tradeoff.
export function parseDaysParam(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(Math.max(Math.trunc(n), MIN_DAYS), MAX_DAYS);
}

// UTC midnight, `days - 1` days before today — the first day of the window
// (today counts as one of the `days`). Everything here is UTC so bucket
// keys match `dateKey` (which reads the UTC date via toISOString) — mixing
// local midnight with UTC keys drops today's rows for anyone east of UTC.
export function windowStart(days: number): Date {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Every YYYY-MM-DD in the window, oldest first, including today.
export function dayRange(days: number): string[] {
  const start = windowStart(days);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return dateKey(d);
  });
}
