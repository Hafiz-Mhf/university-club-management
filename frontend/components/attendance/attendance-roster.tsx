'use client';

import { useMemo, useState } from 'react';
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
import { AttendanceStatusBadge } from '@/components/attendance/attendance-status-badge';
import { useAttendanceList, useMarkAbsent } from '@/features/attendance/use-attendance';
import { resolveParticipantName } from '@/features/attendance/resolve-name';
import { useRegistrations } from '@/features/registrations/use-registrations';
import { useMembers } from '@/features/members/use-members';
import { relativeTime } from '@/features/dashboard/format';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AttendanceStatus } from '@/types/api';

type StatusFilter = 'all' | AttendanceStatus;
const FILTERS: StatusFilter[] = ['all', 'REGISTERED', 'PRESENT', 'ABSENT'];
const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  REGISTERED: 'Registered',
  PRESENT: 'Present',
  ABSENT: 'Absent',
};

export function AttendanceRoster({ orgId, eventId }: { orgId: string; eventId: string }) {
  const attendance = useAttendanceList(orgId, eventId);
  const registrations = useRegistrations(orgId, eventId);
  const members = useMembers(orgId, {});
  const markAbsent = useMarkAbsent(orgId, eventId);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [markingAbsent, setMarkingAbsent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () => (attendance.data ?? []).filter((a) => statusFilter === 'all' || a.status === statusFilter),
    [attendance.data, statusFilter],
  );

  if (attendance.isPending) return null;
  if (attendance.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load attendance.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex w-fit flex-wrap rounded-md border border-border p-0.5">
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant="ghost"
            size="sm"
            onClick={() => setStatusFilter(f)}
            className={cn(statusFilter === f && 'bg-primary/10 text-primary')}
          >
            {FILTER_LABELS[f]}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-muted">
          {statusFilter === 'all' ? 'No one registered yet.' : 'No one matches this filter.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((a) => {
            const name = resolveParticipantName(a, registrations.data ?? [], members.data ?? []);
            const canMarkAbsent = a.status === 'REGISTERED';
            return (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
              >
                <span>{name}</span>
                <div className="flex items-center gap-2">
                  <AttendanceStatusBadge status={a.status} />
                  <span className="hidden text-xs text-foreground-subtle sm:inline">
                    {relativeTime(a.createdAt)}
                  </span>
                  {canMarkAbsent && (
                    <Button variant="destructive" size="sm" onClick={() => setMarkingAbsent(a.id)}>
                      Mark absent
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={markingAbsent !== null} onOpenChange={(open) => !open && setMarkingAbsent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark absent?</DialogTitle>
            <DialogDescription>They&apos;ll be recorded as not attending this event.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMarkingAbsent(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={markAbsent.isPending}
              onClick={() => {
                if (!markingAbsent) return;
                setError(null);
                markAbsent.mutate(markingAbsent, {
                  onSuccess: () => setMarkingAbsent(null),
                  onError: (e) => {
                    setMarkingAbsent(null);
                    setError(e instanceof ApiError ? e.message : 'Something went wrong');
                  },
                });
              }}
            >
              {markAbsent.isPending && <Loader2 className="size-4 animate-spin" />}
              Mark absent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
