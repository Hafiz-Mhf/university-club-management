'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useMinutesList } from '@/features/minutes/use-minutes';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const PAGE_SIZE = 10;

export function MinutesList({
  orgId,
  orgSlug,
  canManage,
}: {
  orgId: string;
  orgSlug: string;
  canManage: boolean;
}) {
  const [page, setPage] = useState(1);
  const minutes = useMinutesList(orgId, page, PAGE_SIZE);

  if (minutes.isPending) return null;
  if (minutes.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load minutes.</p>;
  }

  const { data, total } = minutes.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <Link
          href={`/${orgSlug}/workspace/minutes/new`}
          className={buttonVariants({ size: 'sm', className: 'w-fit' })}
        >
          <Plus className="size-3.5" />
          New minutes
        </Link>
      )}

      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-muted">No minutes yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((m) => (
            <Link
              key={m.id}
              href={`/${orgSlug}/workspace/minutes/${m.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/40"
            >
              <span>{m.title}</span>
              <span className="text-xs text-foreground-subtle">
                {dateFmt.format(new Date(m.meetingDate))} · {m.attendeeMembershipIds.length} attendees
              </span>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-foreground-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
