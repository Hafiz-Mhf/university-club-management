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
import { RegistrationStatusBadge } from '@/components/registrations/registration-status-badge';
import { useRegistrations, useRejectRegistration } from '@/features/registrations/use-registrations';
import { useRegistrationForm } from '@/features/registrations/use-registration-form';
import { formatAnswers } from '@/features/registrations/answers';
import { relativeTime } from '@/features/dashboard/format';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Event, RegistrationStatus } from '@/types/api';

type StatusFilter = 'all' | RegistrationStatus;
const FILTERS: StatusFilter[] = ['all', 'APPROVED', 'WAITLISTED', 'REJECTED', 'CANCELLED'];
const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  APPROVED: 'Approved',
  WAITLISTED: 'Waitlisted',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export function RegistrationsTable({ orgId, event }: { orgId: string; event: Event }) {
  const registrations = useRegistrations(orgId, event.id);
  const formQuery = useRegistrationForm(orgId, event.id);
  const reject = useRejectRegistration(orgId, event.id);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      (registrations.data ?? []).filter((r) => statusFilter === 'all' || r.status === statusFilter),
    [registrations.data, statusFilter],
  );

  if (registrations.isPending) return null;
  if (registrations.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load registrations.</p>;
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
          {statusFilter === 'all' ? 'No registrations yet.' : 'No registrations match this filter.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => {
            const answers = formatAnswers(r.answers, formQuery.data?.fields);
            const canReject = r.status !== 'REJECTED' && r.status !== 'CANCELLED';
            return (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-foreground-muted">{r.userId}</span>
                  <div className="flex items-center gap-2">
                    <RegistrationStatusBadge status={r.status} />
                    <span className="text-xs text-foreground-subtle">{relativeTime(r.createdAt)}</span>
                    {canReject && (
                      <Button variant="destructive" size="sm" onClick={() => setRejecting(r.id)}>
                        Reject
                      </Button>
                    )}
                  </div>
                </div>
                {answers.length > 0 && (
                  <ul className="flex flex-col gap-0.5 text-foreground-muted">
                    {answers.map((a) => (
                      <li key={a.label}>
                        {a.label}: {a.value}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this registration?</DialogTitle>
            <DialogDescription>
              If this was the approved slot, the oldest waitlisted registrant is promoted
              automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Keep registration
            </Button>
            <Button
              variant="destructive"
              disabled={reject.isPending}
              onClick={() => {
                if (!rejecting) return;
                setError(null);
                reject.mutate(rejecting, {
                  onSuccess: () => setRejecting(null),
                  onError: (e) => {
                    setRejecting(null);
                    setError(e instanceof ApiError ? e.message : 'Something went wrong');
                  },
                });
              }}
            >
              {reject.isPending && <Loader2 className="size-4 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
