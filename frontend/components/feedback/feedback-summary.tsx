'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeedbackSummary } from '@/features/feedback/use-feedback';

function fmt(v: number | null) {
  return v === null ? '—' : v.toFixed(1);
}

export function FeedbackSummary({ orgId, eventId }: { orgId: string; eventId: string }) {
  const summary = useFeedbackSummary(orgId, eventId);

  if (summary.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (summary.isError || !summary.data) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load feedback for this event.</p>;
  }

  const s = summary.data;

  if (s.responseCount === 0) {
    return (
      <p className="py-8 text-center text-sm text-foreground-muted">
        No feedback submitted for this event yet.
      </p>
    );
  }

  const tiles: [string, string][] = [
    ['NPS', fmt(s.avgNpsScore)],
    ['Content', fmt(s.avgContentRating)],
    ['Organization', fmt(s.avgOrganizationRating)],
    ['Venue', fmt(s.avgVenueRating)],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <Card key={label} className="shadow-card">
            <CardContent className="flex flex-col gap-1">
              <span className="text-xs font-medium tracking-wide text-foreground-muted uppercase">
                {label}
              </span>
              <span className="font-heading text-2xl font-semibold tabular-nums">{value}</span>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-foreground-muted">
        {s.responseCount} response{s.responseCount === 1 ? '' : 's'}
      </p>
      {s.comments.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Comments</p>
          {s.comments.map((c, i) => (
            <p key={i} className="rounded-lg border border-border p-3 text-sm text-foreground-muted">
              &quot;{c}&quot;
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
