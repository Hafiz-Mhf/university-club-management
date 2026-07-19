'use client';

import Link from 'next/link';
import { MessageSquareHeart } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useEvents } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

export default function FeedbackPage() {
  const { org, membership } = useOrg();
  const eligible = isCommittee(membership.role);
  const events = useEvents(org.id);

  if (!eligible) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
          <MessageSquareHeart className="size-5 text-domain-feedback" />
        </div>
        <h1 className="text-xl font-semibold">Feedback</h1>
        <p className="text-sm text-foreground-muted">
          Feedback summaries are for committee. Submit your own feedback on an event&apos;s page
          after attending.
        </p>
      </main>
    );
  }

  const nonDraft = (events.data ?? []).filter((e) => e.status !== 'DRAFT');

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Feedback</h1>
      {events.isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      )}
      {events.data && nonDraft.length === 0 && (
        <p className="py-8 text-center text-sm text-foreground-muted">
          No events to view feedback for yet.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {nonDraft.map((e) => (
          <Link
            key={e.id}
            href={`/${org.slug}/feedback/${e.id}`}
            className="rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/40"
          >
            {e.title}
          </Link>
        ))}
      </div>
    </main>
  );
}
