'use client';

import { useState } from 'react';
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
import { RegistrationStatusBadge } from '@/components/registrations/registration-status-badge';
import { RegisterDialog } from '@/components/registrations/register-dialog';
import { useCancelRegistration, useMyRegistration } from '@/features/registrations/use-registrations';
import { ApiError } from '@/lib/api';
import type { Event } from '@/types/api';

export function MyRegistrationPanel({ orgId, event }: { orgId: string; event: Event }) {
  const myRegistration = useMyRegistration(orgId, event.id);
  const cancel = useCancelRegistration(orgId, event.id);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (myRegistration.isPending) return null;

  const registration = myRegistration.data;

  if (!registration) {
    if (event.status !== 'PUBLISHED') return null;
    return (
      <div>
        <Button onClick={() => setRegisterOpen(true)}>Register</Button>
        <RegisterDialog
          orgId={orgId}
          eventId={event.id}
          eventTitle={event.title}
          open={registerOpen}
          onOpenChange={setRegisterOpen}
        />
      </div>
    );
  }

  const canCancelReg = registration.status === 'APPROVED' || registration.status === 'WAITLISTED';

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <RegistrationStatusBadge status={registration.status} />
        {canCancelReg && (
          <Button variant="secondary" size="sm" onClick={() => setConfirmingCancel(true)}>
            Cancel my registration
          </Button>
        )}
      </div>

      <Dialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel your registration?</DialogTitle>
            <DialogDescription>
              You can register again later if the event is still published.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingCancel(false)}>
              Keep registration
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => {
                setError(null);
                cancel.mutate(registration.id, {
                  onSuccess: () => setConfirmingCancel(false),
                  onError: (e) => {
                    setConfirmingCancel(false);
                    setError(e instanceof ApiError ? e.message : 'Something went wrong');
                  },
                });
              }}
            >
              {cancel.isPending && <Loader2 className="size-4 animate-spin" />}
              Cancel registration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
