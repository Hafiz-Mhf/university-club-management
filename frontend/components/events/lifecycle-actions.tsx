'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useCancelEvent,
  useCompleteEvent,
  useDeleteEvent,
  usePublishEvent,
} from '@/features/events/use-events';
import { canCancel, canComplete, canDelete, canPublish } from '@/features/events/status';
import { isCommittee, canManageMembers } from '@/features/orgs/roles';
import { ApiError } from '@/lib/api';
import type { Event, MembershipRole } from '@/types/api';

interface LifecycleActionsProps {
  event: Event;
  orgId: string;
  orgSlug: string;
  role: MembershipRole;
}

export function LifecycleActions({ event, orgId, orgSlug, role }: LifecycleActionsProps) {
  const router = useRouter();
  const publish = usePublishEvent(orgId, event.id);
  const complete = useCompleteEvent(orgId, event.id);
  const cancel = useCancelEvent(orgId, event.id);
  const remove = useDeleteEvent(orgId, event.id);

  const [confirming, setConfirming] = useState<'cancel' | 'delete' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const committee = isCommittee(role);
  const manager = canManageMembers(role);

  const fail = (error: unknown) =>
    setActionError(error instanceof ApiError ? error.message : 'Something went wrong');

  const showPublish = committee && canPublish(event.status);
  const showComplete = committee && canComplete(event.status);
  const showCancel = manager && canCancel(event.status);
  const showDelete = manager && canDelete(event.status);

  if (!showPublish && !showComplete && !showCancel && !showDelete) return null;

  return (
    <div className="flex flex-col gap-2">
      {actionError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}
      {/* Forward actions and destructive ones are separated by a divider and a
          margin: "Mark completed" and "Delete" sitting shoulder to shoulder is
          how a mis-click ends an event. */}
      <div className="flex flex-wrap items-center gap-2">
        {showPublish && (
          <Button
            disabled={publish.isPending}
            onClick={() => {
              setActionError(null);
              publish.mutate(undefined, { onError: fail });
            }}
          >
            {publish.isPending && <Loader2 className="size-4 animate-spin" />}
            Publish
          </Button>
        )}
        {showComplete && (
          <Button
            disabled={complete.isPending}
            onClick={() => {
              setActionError(null);
              complete.mutate(undefined, { onError: fail });
            }}
          >
            {complete.isPending && <Loader2 className="size-4 animate-spin" />}
            Mark completed
          </Button>
        )}
        {(showCancel || showDelete) && (showPublish || showComplete) && (
          <span aria-hidden className="mx-2 h-5 w-px bg-border" />
        )}
        {showCancel && (
          <Button variant="ghost" className="text-foreground-muted" onClick={() => setConfirming('cancel')}>
            Cancel event
          </Button>
        )}
        {showDelete && (
          <Button variant="ghost" className="text-danger" onClick={() => setConfirming('delete')}>
            Delete
          </Button>
        )}
      </div>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === 'cancel' ? 'Cancel this event?' : 'Delete this event?'}
            </DialogTitle>
            <DialogDescription>
              {confirming === 'cancel'
                ? 'The event stays on record and everyone registered is emailed that it is off. Registrations are kept, so you can still see who had signed up.'
                : 'The event and its registrations are removed for good. If people have already signed up, cancel it instead so they are told what happened.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Keep event
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending || remove.isPending}
              onClick={() => {
                setActionError(null);
                if (confirming === 'cancel') {
                  cancel.mutate(undefined, {
                    onSuccess: () => setConfirming(null),
                    onError: (e) => {
                      setConfirming(null);
                      fail(e);
                    },
                  });
                } else {
                  remove.mutate(undefined, {
                    onSuccess: () => router.push(`/${orgSlug}/events`),
                    onError: (e) => {
                      setConfirming(null);
                      fail(e);
                    },
                  });
                }
              }}
            >
              {(cancel.isPending || remove.isPending) && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {confirming === 'cancel' ? 'Cancel event' : 'Delete event'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
