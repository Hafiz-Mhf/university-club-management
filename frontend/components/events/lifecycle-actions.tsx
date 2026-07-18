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
        {showCancel && (
          <Button variant="secondary" onClick={() => setConfirming('cancel')}>
            Cancel event
          </Button>
        )}
        {showDelete && (
          <Button variant="destructive" onClick={() => setConfirming('delete')}>
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
                ? 'Registrants will be notified.'
                : 'This cannot be undone.'}
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
