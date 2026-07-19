'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { QrScanner } from '@/components/attendance/qr-scanner';
import { AttendanceRoster } from '@/components/attendance/attendance-roster';
import { useEvent } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { canManageAttendance } from '@/features/orgs/roles';

export default function AttendanceScanPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  const eligible = canManageAttendance(membership.role);
  const event = useEvent(org.id, eventId);

  useEffect(() => {
    if (!eligible) router.replace(`/${org.slug}/attendance`);
  }, [eligible, router, org.slug]);
  if (!eligible) return null;

  if (event.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 rounded-lg" />
      </main>
    );
  }

  if (event.isError || !event.data) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4 text-center lg:p-6">
        <p className="text-sm text-foreground-muted">Couldn&apos;t load this event.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 lg:p-6">
      <Link
        href={`/${org.slug}/attendance`}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All events
      </Link>
      <h1 className="text-2xl font-semibold">{event.data.title}</h1>
      <QrScanner orgId={org.id} eventId={eventId} />
      <AttendanceRoster orgId={org.id} eventId={eventId} />
    </main>
  );
}
