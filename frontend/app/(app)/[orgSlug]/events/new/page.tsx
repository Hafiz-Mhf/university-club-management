'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { EventForm } from '@/components/events/event-form';
import { useCreateEvent } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

export default function NewEventPage() {
  const router = useRouter();
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const create = useCreateEvent(org.id);

  // The backend would 403 the POST anyway — just don't show a dead-end form.
  useEffect(() => {
    if (!committee) router.replace(`/${org.slug}/events`);
  }, [committee, router, org.slug]);
  if (!committee) return null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Create event</h1>
      <EventForm
        mode="create"
        isPending={create.isPending}
        error={create.error}
        onSubmit={(values) =>
          create.mutate(values, {
            onSuccess: (event) => router.push(`/${org.slug}/events/${event.id}`),
          })
        }
      />
    </main>
  );
}
