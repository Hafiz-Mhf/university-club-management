'use client';

import { useMemo } from 'react';
import { QrCode } from 'lucide-react';
import { ParticipationList } from '@/components/participation/participation-list';
import { useMyParticipation } from '@/features/participation/use-participation';
import { useOrg } from '@/features/orgs/org-provider';
import { isActive } from '@/features/participation/status';

/**
 * Participant-facing Attendance. Previously this route told non-committee
 * members "check-in tools are for committee" and stopped — a dead end for the
 * majority of the people who see it in the nav.
 */
export function MyAttendanceView() {
  const { org } = useOrg();
  const participation = useMyParticipation(org.id);
  const now = useMemo(() => new Date(), []);

  // Cancelled and rejected registrations never had a check-in to speak of.
  const items = useMemo(
    () => (participation.data ?? []).filter(isActive),
    [participation.data],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-2xl font-semibold">My check-ins</h1>
        <p className="text-sm text-foreground-muted">
          Open an event to show your check-in code at the door.
        </p>
      </div>

      <ParticipationList
        items={items}
        isPending={participation.isPending}
        isRefreshing={participation.isFetching && !participation.isPending}
        isError={participation.isError}
        onRetry={() => participation.refetch()}
        orgSlug={org.slug}
        now={now}
        emptyIcon={QrCode}
        emptyIconClass="text-domain-attendance"
        emptyTitle="No check-ins yet"
        emptyBody="Once you register for an event, your check-in code and attendance status appear here."
      />
    </main>
  );
}
