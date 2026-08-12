'use client';

import { useMemo, useState } from 'react';
import { MessageSquareHeart } from 'lucide-react';
import { ParticipationList } from '@/components/participation/participation-list';
import { useMyParticipation } from '@/features/participation/use-participation';
import { useOrg } from '@/features/orgs/org-provider';
import { cn } from '@/lib/utils';

type View = 'to-give' | 'given';

/**
 * Participant-facing Feedback. Previously this route told non-committee
 * members that summaries are for committee, with no way to see which events
 * were still waiting on their feedback.
 */
export function MyFeedbackView() {
  const { org } = useOrg();
  const participation = useMyParticipation(org.id);
  const [view, setView] = useState<View>('to-give');
  const now = useMemo(() => new Date(), []);

  // Feedback is only ever open to someone who actually turned up — mirrors
  // resolveFeedbackPanelState, which hides the form unless attendance is
  // PRESENT.
  const attended = useMemo(
    () => (participation.data ?? []).filter((item) => item.attendance?.status === 'PRESENT'),
    [participation.data],
  );

  const visible = useMemo(
    () => attended.filter((item) => (view === 'to-give' ? !item.feedbackSubmitted : item.feedbackSubmitted)),
    [attended, view],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-2xl font-semibold">My feedback</h1>
        <p className="text-sm text-foreground-muted">
          Open an event you attended to rate it, or to read back what you said.
        </p>
      </div>

      <div className="flex w-fit rounded-md border border-border p-0.5">
        {(
          [
            ['to-give', 'To give'],
            ['given', 'Given'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              view === id ? 'bg-primary/10 text-primary' : 'text-foreground-muted hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <ParticipationList
        items={visible}
        isPending={participation.isPending}
        isRefreshing={participation.isFetching && !participation.isPending}
        isError={participation.isError}
        onRetry={() => participation.refetch()}
        orgSlug={org.slug}
        now={now}
        showAttendance={false}
        emptyIcon={MessageSquareHeart}
        emptyIconClass="text-domain-feedback"
        emptyTitle={view === 'to-give' ? "You're all caught up" : 'No feedback given yet'}
        emptyBody={
          view === 'to-give'
            ? 'Events you attended that still want your rating will show up here.'
            : 'Feedback you submit appears here so you can look back at what you said.'
        }
      />
    </main>
  );
}
