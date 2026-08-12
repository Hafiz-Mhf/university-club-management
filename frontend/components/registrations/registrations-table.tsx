'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RegistrationStatusBadge } from '@/components/registrations/registration-status-badge';
import {
  useApproveRegistration,
  useRegistrations,
  useRejectRegistration,
} from '@/features/registrations/use-registrations';
import { useRegistrationForm } from '@/features/registrations/use-registration-form';
import { formatAnswers } from '@/features/registrations/answers';
import { csvFilename, downloadCsv, registrationsToCsv } from '@/features/registrations/csv';
import { shortDate } from '@/features/dashboard/format';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Event, RegistrationStatus, RegistrationWithUser } from '@/types/api';
import { Refreshing } from '@/components/ui/refreshing';
import { SkeletonList } from '@/components/ui/skeleton-list';

type StatusFilter = 'all' | RegistrationStatus;
const FILTERS: StatusFilter[] = ['all', 'APPROVED', 'WAITLISTED', 'REJECTED', 'CANCELLED'];
const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  APPROVED: 'Approved',
  WAITLISTED: 'Waitlist',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

type SortKey = 'name' | 'status' | 'createdAt';
/** Waitlist first: the rows a committee actually has to decide about. */
const STATUS_RANK: Record<RegistrationStatus, number> = {
  WAITLISTED: 0,
  APPROVED: 1,
  REJECTED: 2,
  CANCELLED: 3,
};

function SortHeader({
  label,
  sortKey,
  active,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const Icon = direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {label}
        {active && <Icon className="size-3" aria-hidden />}
      </button>
    </TableHead>
  );
}

export function RegistrationsTable({ orgId, event }: { orgId: string; event: Event }) {
  const registrations = useRegistrations(orgId, event.id);
  const formQuery = useRegistrationForm(orgId, event.id);
  const reject = useRejectRegistration(orgId, event.id);
  const approve = useApproveRegistration(orgId, event.id);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'status',
    direction: 'asc',
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<RegistrationWithUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => registrations.data ?? [], [registrations.data]);

  const counts = useMemo(() => {
    const byStatus = { all: rows.length } as Record<StatusFilter, number>;
    for (const f of FILTERS) if (f !== 'all') byStatus[f] = 0;
    for (const r of rows) byStatus[r.status] += 1;
    return byStatus;
  }, [rows]);

  const visible = useMemo(() => {
    const filtered = rows.filter((r) => statusFilter === 'all' || r.status === statusFilter);
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === 'name') return factor * a.user.fullName.localeCompare(b.user.fullName);
      if (sort.key === 'createdAt') return factor * (Date.parse(a.createdAt) - Date.parse(b.createdAt));
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      // Within one status, oldest first — that is waitlist order.
      return factor * (rank || Date.parse(a.createdAt) - Date.parse(b.createdAt));
    });
  }, [rows, statusFilter, sort]);

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
  }

  if (registrations.isPending) return <SkeletonList rows={5} label="Loading registrations" />;
  if (registrations.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-foreground-muted">Couldn&apos;t load registrations.</p>
        <Button variant="secondary" onClick={() => registrations.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const seatsLeft =
    event.capacity === null ? null : Math.max(0, event.capacity - counts.APPROVED);

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-md border border-border p-0.5" role="group" aria-label="Filter registrations by status">
          {FILTERS.map((f) => (
            <Button
              key={f}
              variant="ghost"
              size="sm"
              aria-pressed={statusFilter === f}
              onClick={() => setStatusFilter(f)}
              className={cn(statusFilter === f && 'bg-primary/10 text-primary')}
            >
              {FILTER_LABELS[f]}
              <span className="ml-1 tabular-nums text-foreground-muted">{counts[f]}</span>
            </Button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {seatsLeft !== null && (
            <span className="text-xs text-foreground-muted">
              {counts.APPROVED} of {event.capacity} seats taken
              {seatsLeft === 0 && counts.WAITLISTED > 0 && ' · waitlist active'}
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(csvFilename(event.title), registrationsToCsv(visible, formQuery.data?.fields))
            }
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-foreground-muted">
          {statusFilter === 'all'
            ? 'Nobody has registered yet. Registrations appear here the moment someone signs up on the public page.'
            : `No ${FILTER_LABELS[statusFilter].toLowerCase()} registrations.`}
        </p>
      ) : (
        <Refreshing active={registrations.isFetching} label="Refreshing registrations">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <SortHeader label="Registrant" sortKey="name" active={sort.key === 'name'} direction={sort.direction} onSort={toggleSort} />
                <SortHeader label="Status" sortKey="status" active={sort.key === 'status'} direction={sort.direction} onSort={toggleSort} />
                <SortHeader label="Registered" sortKey="createdAt" active={sort.key === 'createdAt'} direction={sort.direction} onSort={toggleSort} className="hidden sm:table-cell" />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => {
                const answers = formatAnswers(r.answers, formQuery.data?.fields).filter(
                  (a) => a.value !== '' && a.value != null,
                );
                const isOpen = expanded === r.id;
                const canApprove = r.status === 'WAITLISTED' || r.status === 'REJECTED';
                const canReject = r.status !== 'REJECTED' && r.status !== 'CANCELLED';
                const busy =
                  (approve.isPending && approve.variables === r.id) ||
                  (reject.isPending && rejecting?.id === r.id);

                return [
                  <TableRow key={r.id} data-selected={isOpen}>
                    <TableCell className="pr-0">
                      {answers.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} form answers for ${r.user.fullName}`}
                          className="rounded-sm p-1 text-foreground-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} />
                        </button>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{r.user.fullName}</span>
                        <span className="text-xs text-foreground-muted">
                          {r.user.studentId ?? r.user.email}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RegistrationStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell numeric className="hidden text-foreground-muted sm:table-cell">
                      {shortDate(r.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {busy && <Loader2 className="size-3.5 animate-spin text-foreground-muted" aria-hidden />}
                        {canApprove && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={approve.isPending}
                            onClick={() => {
                              setError(null);
                              approve.mutate(r.id, {
                                onSuccess: () => toast.success(`${r.user.fullName} is in`),
                                onError: (e) =>
                                  setError(e instanceof ApiError ? e.message : 'Something went wrong'),
                              });
                            }}
                          >
                            {r.status === 'REJECTED' ? 'Undo reject' : 'Approve'}
                          </Button>
                        )}
                        {canReject && (
                          <Button variant="ghost" size="sm" className="text-danger" onClick={() => setRejecting(r)}>
                            Reject
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>,
                  isOpen && (
                    <TableRow key={`${r.id}-answers`} data-selected>
                      <TableCell />
                      <TableCell colSpan={4} className="pt-0 pb-3">
                        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                          {answers.map((a) => (
                            <div key={a.label} className="flex gap-2">
                              <dt className="text-foreground-muted">{a.label}</dt>
                              <dd className="font-medium">{a.value === 'true' ? 'Yes' : a.value}</dd>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <dt className="text-foreground-muted">Email</dt>
                            <dd className="font-medium">{r.user.email}</dd>
                          </div>
                          {r.user.programme && (
                            <div className="flex gap-2">
                              <dt className="text-foreground-muted">Programme</dt>
                              <dd className="font-medium">{r.user.programme}</dd>
                            </div>
                          )}
                        </dl>
                      </TableCell>
                    </TableRow>
                  ),
                ];
              })}
            </TableBody>
          </Table>
        </Refreshing>
      )}

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejecting?.user.fullName}&apos;s registration?</DialogTitle>
            <DialogDescription>
              {rejecting?.status === 'APPROVED'
                ? 'They lose their seat, and the longest-waiting person on the waitlist takes it automatically. You can undo this afterwards if a seat is free.'
                : 'They come off the waitlist. You can undo this afterwards if a seat is free.'}
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
                const name = rejecting.user.fullName;
                setError(null);
                reject.mutate(rejecting.id, {
                  onSuccess: () => {
                    setRejecting(null);
                    toast.success(`${name}'s registration was rejected`);
                  },
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
