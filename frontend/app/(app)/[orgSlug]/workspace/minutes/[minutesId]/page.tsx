'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardList, Loader2, Pencil } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDeleteMinutes, useMinutes } from '@/features/minutes/use-minutes';
import { resolveAttendeeNames } from '@/features/minutes/resolve-attendee-names';
import { useMembers } from '@/features/members/use-members';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { ApiError } from '@/lib/api';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function MinutesNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
        <ClipboardList className="size-5 text-foreground-muted" />
      </div>
      <h1 className="text-xl font-semibold">Minutes not found</h1>
      <p className="text-sm text-foreground-muted">
        They may have been removed, or you don&apos;t have access to them.
      </p>
    </div>
  );
}

export default function MinutesDetailPage({
  params,
}: {
  params: Promise<{ minutesId: string }>;
}) {
  const { minutesId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const minutes = useMinutes(org.id, minutesId);
  const members = useMembers(org.id, {});
  const remove = useDeleteMinutes(org.id);
  const [removing, setRemoving] = useState(false);

  if (minutes.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 rounded-lg" />
      </main>
    );
  }

  if (minutes.isError) {
    if (minutes.error instanceof ApiError && minutes.error.status === 404) {
      return <MinutesNotFound />;
    }
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-foreground-muted">Couldn&apos;t load these minutes.</p>
        <Button variant="secondary" onClick={() => minutes.refetch()}>
          Try again
        </Button>
      </main>
    );
  }

  const m = minutes.data;
  // GET /members is VIEW_MEMBERS-gated (committee-only) but this detail
  // page is visible to any org member — a 403 here is an expected
  // authorization boundary, not a missing row, so it must not fall
  // through to resolveAttendeeNames's raw-id fallback (that would leak
  // internal membership ids — the exact bug fixed in Slice 9's FileList
  // and pre-empted in Slice 10's AssetList).
  const attendeeNames = members.isError
    ? m.attendeeMembershipIds.map(() => 'Committee member')
    : resolveAttendeeNames(m.attendeeMembershipIds, members.data ?? []);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <Link
        href={`/${org.slug}/workspace`}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Workspace
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{m.title}</h1>
          <p className="text-sm text-foreground-muted">{dateFmt.format(new Date(m.meetingDate))}</p>
        </div>
        {committee && (
          <Link
            href={`/${org.slug}/workspace/minutes/${minutesId}/edit`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Pencil className="size-3.5" />
            Edit
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Attendees</h2>
        <p className="text-sm text-foreground-muted">
          {attendeeNames.length === 0 ? 'No attendees recorded.' : attendeeNames.join(', ')}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Agenda</h2>
        {m.agendaItems.length === 0 ? (
          <p className="text-sm text-foreground-muted">No agenda items.</p>
        ) : (
          m.agendaItems.map((item, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <p className="font-medium">{item.topic}</p>
              <p className="text-sm text-foreground-muted">{item.notes}</p>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Action items</h2>
        {m.actionItems.length === 0 ? (
          <p className="text-sm text-foreground-muted">No action items.</p>
        ) : (
          m.actionItems.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
            >
              <span>{item.task}</span>
              {item.owner && <span className="text-foreground-muted">{item.owner}</span>}
            </div>
          ))
        )}
      </div>

      {committee && (
        <Button variant="destructive" size="sm" className="w-fit" onClick={() => setRemoving(true)}>
          Remove minutes
        </Button>
      )}

      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove these minutes?</DialogTitle>
            <DialogDescription>This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(minutesId, {
                  onSuccess: () => router.push(`/${org.slug}/workspace`),
                });
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
