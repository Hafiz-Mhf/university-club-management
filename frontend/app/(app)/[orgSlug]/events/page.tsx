'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Plus, Search } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EventCard } from '@/components/events/event-card';
import { useEvents } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import type { Event, EventStatus } from '@/types/api';
import { cn } from '@/lib/utils';
import { Refreshing } from '@/components/ui/refreshing';
import { SkeletonList } from '@/components/ui/skeleton-list';

type StatusFilter = 'all' | EventStatus;
type View = 'upcoming' | 'past';

export default function EventsPage() {
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const events = useEvents(org.id);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [view, setView] = useState<View>('upcoming');

  const filtered = useMemo(() => {
    const now = Date.now();
    return (events.data ?? [])
      .filter((e: Event) => {
        if (search && !e.title.toLowerCase().includes(search.toLowerCase())) return false;
        if (statusFilter !== 'all' && e.status !== statusFilter) return false;
        const upcoming = new Date(e.startAt).getTime() >= now;
        return view === 'upcoming' ? upcoming : !upcoming;
      })
      .sort((a, b) =>
        view === 'upcoming'
          ? new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
          : new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
      );
  }, [events.data, search, statusFilter, view]);

  const hasAnyEvents = (events.data?.length ?? 0) > 0;
  const filtersActive = search !== '' || statusFilter !== 'all';

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Events</h1>
        {committee && (
          <Link href={`/${org.slug}/events/new`} className={buttonVariants()}>
            <Plus className="size-4" />
            Create event
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            placeholder="Search events…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            aria-label="Search events by title"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
        >
          <option value="all">All statuses</option>
          {committee && <option value="DRAFT">Draft</option>}
          <option value="PUBLISHED">Published</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <div className="flex rounded-md border border-border p-0.5">
          {(['upcoming', 'past'] as const).map((v) => (
            <Button
              key={v}
              variant="ghost"
              size="sm"
              onClick={() => setView(v)}
              className={cn('capitalize', view === v && 'bg-primary/10 text-primary')}
            >
              {v}
            </Button>
          ))}
        </div>
      </div>

      {events.isPending && (
        <SkeletonList rows={3} rowClassName="h-24" className="gap-3" label="Loading events" />
      )}

      {events.isError && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-foreground-muted">Couldn&apos;t load events.</p>
          <Button variant="secondary" onClick={() => events.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {events.data && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
            <CalendarDays className="size-5 text-domain-events" />
          </div>
          {hasAnyEvents || filtersActive ? (
            <p className="text-sm text-foreground-muted">
              {filtersActive
                ? 'No events match your search or filter.'
                : `No ${view} events.`}
            </p>
          ) : (
            <>
              <p className="text-sm text-foreground-muted">No events yet.</p>
              {committee && (
                <Link href={`/${org.slug}/events/new`} className={buttonVariants({ variant: 'secondary' })}>
                  Create your first event
                </Link>
              )}
            </>
          )}
        </div>
      )}

      <Refreshing
        active={events.isFetching && !events.isPending}
        label="Refreshing events"
        className="flex flex-col gap-3"
      >
        {filtered.map((event) => (
          <EventCard key={event.id} event={event} orgSlug={org.slug} />
        ))}
      </Refreshing>
    </main>
  );
}
