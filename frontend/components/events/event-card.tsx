import Link from 'next/link';
import { CalendarDays, ChevronRight, MapPin, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EventStatusBadge } from '@/components/events/event-status-badge';
import type { Event, EventListItem } from '@/types/api';

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function eventDateRange(event: Pick<Event, 'startAt' | 'endAt'>): string {
  return `${dateFmt.format(new Date(event.startAt))} – ${dateFmt.format(new Date(event.endAt))}`;
}

/**
 * "9 of 6 seats" is the number a committee triages on, so the row carries it
 * rather than making them open the event to find out how full it is. Falls
 * back to a plain headcount when the event has no capacity.
 */
function headcount(event: EventListItem): { label: string; full: boolean } {
  if (event.capacity === null) {
    return { label: `${event.approvedCount} registered`, full: false };
  }
  const full = event.approvedCount >= event.capacity;
  const waitlist = event.waitlistedCount > 0 ? ` · ${event.waitlistedCount} waiting` : '';
  return { label: `${event.approvedCount}/${event.capacity} seats${waitlist}`, full };
}

export function EventCard({ event, orgSlug }: { event: EventListItem; orgSlug: string }) {
  const count = headcount(event);

  return (
    <Link href={`/${orgSlug}/events/${event.id}`} className="group">
      <Card className="shadow-card transition-colors group-hover:border-primary/40">
        <CardContent className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-heading text-base font-semibold">{event.title}</h2>
              <EventStatusBadge status={event.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground-muted">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                {eventDateRange(event)}
              </span>
              {event.venue && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-3.5" />
                  {event.venue}
                </span>
              )}
              {event.status !== 'DRAFT' && (
                <span
                  className={`flex items-center gap-1.5 tabular-nums ${count.full ? 'text-warning' : ''}`}
                >
                  <Users className="size-3.5" />
                  {count.label}
                </span>
              )}
            </div>
          </div>
          <ChevronRight
            className="size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </CardContent>
      </Card>
    </Link>
  );
}
