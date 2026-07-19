export interface BarDatum {
  label: string;
  value: number;
}

// demographics.faculty/.programme groups can carry value: null (member
// never set it) — rendered as "Unspecified", never left blank.
export function toBarData(groups: { value: string | null; count: number }[]): BarDatum[] {
  return groups
    .map((g) => ({ label: g.value ?? 'Unspecified', value: g.count }))
    .sort((a, b) => b.value - a.value);
}

// committee-activity rows arrive pre-sorted descending by the backend
// (AnalyticsService#getCommitteeActivity) — no re-sort here.
export function committeeActivityToBarData(
  rows: { fullName: string; actionCount: number }[],
): BarDatum[] {
  return rows.map((r) => ({ label: r.fullName, value: r.actionCount }));
}
