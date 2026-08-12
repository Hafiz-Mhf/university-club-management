'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { EventStatusBadge } from '@/components/events/event-status-badge';
import { Refreshing } from '@/components/ui/refreshing';
import { SkeletonList } from '@/components/ui/skeleton-list';
import { useEvents } from '@/features/events/use-events';
import { eventDateRange } from '@/components/events/event-card';
import type { EventListItem } from '@/types/api';

/**
 * Attendance and Certificates both start with "which event?". They used to
 * render a bare list of titles, which told a committee member nothing about
 * which one was happening now or how many people were involved. One component,
 * so the two pages can't drift apart again.
 */
export function EventPickerList({
  orgId,
  hrefFor,
  title,
  emptyMessage,
  secondaryFor,
}: {
  orgId: string;
  hrefFor: (event: EventListItem) => string;
  title: string;
  emptyMessage: string;
  /** Extra per-event context, e.g. "9 of 12 checked in". */
  secondaryFor?: (event: EventListItem) => string;
}) {
  const events = useEvents(orgId);
  // Pinned at mount: reading the clock during render makes the sort impure and
  // would reshuffle the list on unrelated re-renders.
  const [now] = useState(() => Date.now());

  // Live events first, then upcoming soonest-first, then past newest-first:
  // the door-scanning case wants today's event at the top, always.
  const ordered = [...(events.data ?? [])]
    .filter((e) => e.status !== 'DRAFT')
    .map((e) => {
      const start = Date.parse(e.startAt);
      const end = Date.parse(e.endAt);
      const phase = now >= start && now <= end ? 0 : now < start ? 1 : 2;
      return { event: e, phase, start };
    })
    .sort((a, b) => a.phase - b.phase || (a.phase === 2 ? b.start - a.start : a.start - b.start));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>

      {events.isPending && <SkeletonList rows={3} rowClassName="h-16" label="Loading events" />}

      {events.data && ordered.length === 0 && (
        <p className="py-10 text-center text-sm text-foreground-muted">{emptyMessage}</p>
      )}

      <Refreshing
        active={events.isFetching && !events.isPending}
        label="Refreshing events"
        className="flex flex-col gap-2"
      >
        {ordered.map(({ event, phase }) => (
          <Link
            key={event.id}
            href={hrefFor(event)}
            className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/40"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{event.title}</span>
                {phase === 0 && (
                  <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    Happening now
                  </span>
                )}
                <EventStatusBadge status={event.status} />
              </div>
              <span className="truncate text-xs text-foreground-muted">
                {eventDateRange(event)}
                {secondaryFor ? ` · ${secondaryFor(event)}` : ''}
              </span>
            </div>
            <ChevronRight className="size-4 shrink-0 text-foreground-subtle" aria-hidden />
          </Link>
        ))}
      </Refreshing>
    </main>
  );
}
