'use client';

import Link from 'next/link';
import { useAnalyticsFeedback } from '@/features/analytics/use-analytics';
import { useEvents } from '@/features/events/use-events';
import { resolveEventTitle } from '@/features/analytics/resolve-event-title';
import { useOrg } from '@/features/orgs/org-provider';

function fmt(v: number) {
  return v.toFixed(1);
}

export function FeedbackTable({ orgId }: { orgId: string }) {
  const { org } = useOrg();
  const feedback = useAnalyticsFeedback(orgId);
  const events = useEvents(orgId);

  if (feedback.isPending) return null;
  if (feedback.isError || !feedback.data) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load feedback data.</p>;
  }
  if (feedback.data.data.length === 0) {
    return <p className="py-4 text-center text-sm text-foreground-muted">No feedback submitted yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-foreground-muted uppercase">
            <th className="py-2 pr-4 font-medium">Event</th>
            <th className="py-2 pr-4 font-medium">Responses</th>
            <th className="py-2 pr-4 font-medium">NPS</th>
            <th className="py-2 pr-4 font-medium">Content</th>
            <th className="py-2 pr-4 font-medium">Organization</th>
            <th className="py-2 font-medium">Venue</th>
          </tr>
        </thead>
        <tbody>
          {feedback.data.data.map((row) => (
            <tr key={row.eventId} className="border-b border-border last:border-0">
              <td className="py-2 pr-4">
                <Link href={`/${org.slug}/feedback/${row.eventId}`} className="hover:underline">
                  {resolveEventTitle(row.eventId, events.data ?? [])}
                </Link>
              </td>
              <td className="py-2 pr-4 tabular-nums">{row.responseCount}</td>
              <td className="py-2 pr-4 tabular-nums">{fmt(row.avgNpsScore)}</td>
              <td className="py-2 pr-4 tabular-nums">{fmt(row.avgContentRating)}</td>
              <td className="py-2 pr-4 tabular-nums">{fmt(row.avgOrganizationRating)}</td>
              <td className="py-2 tabular-nums">{fmt(row.avgVenueRating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
