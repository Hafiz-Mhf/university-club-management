'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, CalendarDays, MapPin, Pencil, Users } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EventNotFound } from '@/components/events/event-not-found';
import { EventStatusBadge } from '@/components/events/event-status-badge';
import { LifecycleActions } from '@/components/events/lifecycle-actions';
import { eventDateRange } from '@/components/events/event-card';
import { MyEventPanels } from '@/components/events/my-event-panels';
import { RegistrationFormEditor } from '@/components/registrations/registration-form-editor';
import { RegistrationsTable } from '@/components/registrations/registrations-table';
import { useEvent } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { canEdit } from '@/features/events/status';
import { isCommittee } from '@/features/orgs/roles';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'form' | 'registrations';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'form', label: 'Registration Form' },
  { id: 'registrations', label: 'Registrations' },
];

export default function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const { org, membership } = useOrg();
  const event = useEvent(org.id, eventId);
  // The dashboard's waitlist rows link straight at ?tab=registrations, which is
  // where the approve action lives.
  const requestedTab = useSearchParams().get('tab');
  const [tab, setTab] = useState<Tab>(
    TABS.some((t) => t.id === requestedTab) ? (requestedTab as Tab) : 'overview',
  );
  const committee = isCommittee(membership.role);

  if (event.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 rounded-lg" />
      </main>
    );
  }

  if (event.isError) {
    if (event.error instanceof ApiError && event.error.status === 404) {
      return <EventNotFound />;
    }
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-foreground-muted">Couldn&apos;t load this event.</p>
        <Button variant="secondary" onClick={() => event.refetch()}>
          Try again
        </Button>
      </main>
    );
  }

  const e = event.data;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <Link
        href={`/${org.slug}/events`}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All events
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{e.title}</h1>
          <EventStatusBadge status={e.status} />
        </div>
        {committee && canEdit(e.status) && (
          <Link
            href={`/${org.slug}/events/${e.id}/edit`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Pencil className="size-3.5" />
            Edit
          </Link>
        )}
      </div>

      {committee && (
        <div
          role="tablist"
          aria-label="Event sections"
          className="flex w-fit flex-wrap rounded-md border border-border p-0.5"
        >
          {TABS.map((t) => (
            <Button
              key={t.id}
              role="tab"
              id={`event-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`event-panel-${t.id}`}
              variant="ghost"
              size="sm"
              onClick={() => setTab(t.id)}
              className={cn(tab === t.id && 'bg-primary/10 text-primary')}
            >
              {t.label}
            </Button>
          ))}
        </div>
      )}

      {(tab === 'overview' || !committee) && (
        <div
          id="event-panel-overview"
          role={committee ? 'tabpanel' : undefined}
          aria-labelledby={committee ? 'event-tab-overview' : undefined}
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-2 text-sm text-foreground-muted">
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4" />
              {eventDateRange(e)}
            </span>
            {e.venue && (
              <span className="flex items-center gap-2">
                <MapPin className="size-4" />
                {e.venue}
              </span>
            )}
            <span className="flex items-center gap-2">
              <Users className="size-4" />
              {e.capacity === null ? 'Unlimited capacity' : `Capacity: ${e.capacity}`}
            </span>
          </div>

          {e.description && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{e.description}</p>
          )}

          <MyEventPanels orgId={org.id} event={e} />

          <LifecycleActions event={e} orgId={org.id} orgSlug={org.slug} role={membership.role} />
        </div>
      )}

      {committee && tab === 'form' && (
        <div id="event-panel-form" role="tabpanel" aria-labelledby="event-tab-form">
          <RegistrationFormEditor orgId={org.id} event={e} />
        </div>
      )}
      {committee && tab === 'registrations' && (
        <div id="event-panel-registrations" role="tabpanel" aria-labelledby="event-tab-registrations">
          <RegistrationsTable orgId={org.id} event={e} />
        </div>
      )}
    </main>
  );
}
