'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { MinutesForm } from '@/components/minutes/minutes-form';
import { useMinutes, useUpdateMinutes } from '@/features/minutes/use-minutes';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

/** ISO date/datetime → the YYYY-MM-DD shape a date input needs. */
function isoToDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export default function EditMinutesPage({
  params,
}: {
  params: Promise<{ minutesId: string }>;
}) {
  const { minutesId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const minutes = useMinutes(org.id, minutesId);
  const update = useUpdateMinutes(org.id);

  useEffect(() => {
    if (!committee) router.replace(`/${org.slug}/workspace/minutes/${minutesId}`);
  }, [committee, router, org.slug, minutesId]);
  if (!committee) return null;

  if (minutes.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-1/2 rounded-md" />
        <Skeleton className="h-72 rounded-lg" />
      </main>
    );
  }

  if (minutes.isError) return null;

  const m = minutes.data;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Edit minutes</h1>
      <MinutesForm
        orgId={org.id}
        mode="edit"
        defaultValues={{
          title: m.title,
          meetingDate: isoToDateInput(m.meetingDate),
          attendeeMembershipIds: m.attendeeMembershipIds,
          agendaItems: m.agendaItems,
          actionItems: m.actionItems.map((a) => ({ task: a.task, owner: a.owner ?? '' })),
        }}
        isPending={update.isPending}
        error={update.error}
        onSubmit={(values) =>
          update.mutate(
            { minutesId, input: values },
            { onSuccess: () => router.push(`/${org.slug}/workspace/minutes/${minutesId}`) },
          )
        }
      />
    </main>
  );
}
