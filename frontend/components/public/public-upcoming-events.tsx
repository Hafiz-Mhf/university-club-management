import { CalendarDays } from 'lucide-react';
import type { PublicProfile } from '@/types/api';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function PublicUpcomingEvents({ events }: { events: PublicProfile['upcomingEvents'] }) {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4">
      <h2 className="text-lg font-medium">Upcoming events</h2>
      {events.length === 0 ? (
        <p className="text-sm text-foreground-muted">No upcoming events.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-domain-events" />
              <div>
                <p className="text-sm font-medium">{e.title}</p>
                <p className="text-sm text-foreground-muted">
                  {dateFmt.format(new Date(e.startAt))}
                  {e.venue ? ` · ${e.venue}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
