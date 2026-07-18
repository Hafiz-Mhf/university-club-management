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
import { useChangeRole } from '@/features/members/use-members';
import { ApiError } from '@/lib/api';
import type { Member, MembershipRole } from '@/types/api';

const ROLE_OPTIONS: MembershipRole[] = [
  'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
  'COMMITTEE', 'VOLUNTEER', 'PARTICIPANT', 'ADVISOR',
];

interface ChangeRoleDialogProps {
  orgId: string;
  member: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangeRoleDialog({ orgId, member, open, onOpenChange }: ChangeRoleDialogProps) {
  const changeRole = useChangeRole(orgId, member.id);
  const [nextRole, setNextRole] = useState<MembershipRole>(member.role);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const escalates = nextRole === 'PRESIDENT' || nextRole === 'VICE_PRESIDENT';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setConfirming(false);
          setError(null);
          setNextRole(member.role);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>
            Current role: {member.role.replace('_', ' ')}.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {!confirming ? (
          <>
            <select
              value={nextRole}
              onChange={(e) => setNextRole(e.target.value as MembershipRole)}
              aria-label="New role"
              className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </select>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={nextRole === member.role}
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm">
              {escalates
                ? `This will give ${member.user.fullName} full org control as ${nextRole.replace('_', ' ')}.`
                : `Change ${member.user.fullName}'s role to ${nextRole.replace('_', ' ')}?`}
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button
                disabled={changeRole.isPending}
                onClick={() => {
                  setError(null);
                  changeRole.mutate(nextRole, {
                    onSuccess: () => onOpenChange(false),
                    onError: (e) => {
                      setConfirming(false);
                      setError(e instanceof ApiError ? e.message : 'Something went wrong');
                    },
                  });
                }}
              >
                {changeRole.isPending && <Loader2 className="size-4 animate-spin" />}
                Confirm
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
