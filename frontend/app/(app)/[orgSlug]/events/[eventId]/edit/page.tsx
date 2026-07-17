'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { EventForm } from '@/components/events/event-form';
import { EventNotFound } from '@/components/events/event-not-found';
import { useEvent, useUpdateEvent } from '@/features/events/use-events';
import { canEdit } from '@/features/events/status';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { ApiError } from '@/lib/api';

/** ISO timestamp → the local `YYYY-MM-DDTHH:mm` shape datetime-local inputs need. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const event = useEvent(org.id, eventId);
  const update = useUpdateEvent(org.id, eventId);

  const terminal = event.data && !canEdit(event.data.status);

  useEffect(() => {
    if (!committee) router.replace(`/${org.slug}/events`);
    else if (terminal) router.replace(`/${org.slug}/events/${eventId}`);
  }, [committee, terminal, router, org.slug, eventId]);

  if (!committee || terminal) return null;

  if (event.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-1/2 rounded-md" />
        <Skeleton className="h-72 rounded-lg" />
      </main>
    );
  }

  if (event.isError) {
    return event.error instanceof ApiError && event.error.status === 404 ? (
      <EventNotFound />
    ) : null;
  }

  const e = event.data;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Edit event</h1>
      <EventForm
        mode="edit"
        isPending={update.isPending}
        error={update.error}
        defaultValues={{
          title: e.title,
          description: e.description ?? '',
          venue: e.venue ?? '',
          startAt: isoToLocalInput(e.startAt),
          endAt: isoToLocalInput(e.endAt),
          capacity: e.capacity === null ? '' : String(e.capacity),
        }}
        onSubmit={(values) =>
          update.mutate(values, {
            onSuccess: () => router.push(`/${org.slug}/events/${eventId}`),
          })
        }
      />
    </main>
  );
}
