import Link from 'next/link';
import { CalendarDays, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EventStatusBadge } from '@/components/events/event-status-badge';
import type { Event } from '@/types/api';

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function eventDateRange(event: Pick<Event, 'startAt' | 'endAt'>): string {
  return `${dateFmt.format(new Date(event.startAt))} – ${dateFmt.format(new Date(event.endAt))}`;
}

export function EventCard({ event, orgSlug }: { event: Event; orgSlug: string }) {
  return (
    <Link href={`/${orgSlug}/events/${event.id}`} className="group">
      <Card className="shadow-card transition-colors group-hover:border-primary/40">
        <CardContent className="flex flex-col gap-2">
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
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
