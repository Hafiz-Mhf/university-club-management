export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Chart axis dates. The API returns ISO days ("2026-07-17"); rendering those
 * raw turned every axis into a row of machine timestamps. Parsed as UTC so a
 * date-only string can't slip a day backwards in negative-offset timezones.
 */
export function chartDate(isoDay: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay);
  if (!match) return isoDay;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
