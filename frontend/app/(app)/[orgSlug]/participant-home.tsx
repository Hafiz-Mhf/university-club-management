'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Award, CalendarDays, MessageSquareHeart, QrCode } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { SkeletonList } from '@/components/ui/skeleton-list';
import { ParticipationList } from '@/components/participation/participation-list';
import { useMyParticipation } from '@/features/participation/use-participation';
import { isActive, isUpcoming, summarize } from '@/features/participation/status';
import { useOrg } from '@/features/orgs/org-provider';
import { cn } from '@/lib/utils';

type View = 'upcoming' | 'past';

/**
 * Landing for non-committee roles — the committee dashboard endpoint is
 * MANAGE_EVENTS-gated server-side, so we never fire that query for them. This
 * reads their own participation instead, which is the equivalent question for
 * a participant: what am I signed up for, and what do I need to do next.
 */
export function ParticipantHome() {
  const { org } = useOrg();
  const participation = useMyParticipation(org.id);
  const [view, setView] = useState<View>('upcoming');

  // Stable across renders so row-level "is this still upcoming" decisions
  // don't shift mid-interaction.
  const now = useMemo(() => new Date(), []);
  const items = useMemo(() => participation.data ?? [], [participation.data]);
  const summary = useMemo(() => summarize(items, now), [items, now]);

  const visible = useMemo(
    () =>
      items.filter((item) =>
        view === 'upcoming' ? isActive(item) && isUpcoming(item, now) : !isUpcoming(item, now),
      ),
    [items, view, now],
  );

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold">My events</h1>
          <p className="text-sm text-foreground-muted">Everything you&apos;re signed up for at {org.name}.</p>
        </div>
        <Link href={`/${org.slug}/events`} className={buttonVariants({ variant: 'secondary' })}>
          Browse events
        </Link>
      </div>

      {participation.isPending ? (
        // Without this the cards would render a confident "0" for every metric
        // before any data exists — worse than showing nothing.
        <SkeletonList
          rows={4}
          rowClassName="h-24"
          label="Loading your event summary"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Upcoming"
            value={summary.upcoming}
            icon={CalendarDays}
            hue={['text-domain-events', 'bg-domain-events/10']}
          />
          <KpiCard
            label="Attended"
            value={summary.attended}
            icon={QrCode}
            hue={['text-domain-attendance', 'bg-domain-attendance/10']}
          />
          <KpiCard
            label="Certificates"
            value={summary.certificates}
            icon={Award}
            hue={['text-domain-certificates', 'bg-domain-certificates/10']}
          />
          <KpiCard
            label="Feedback to give"
            value={summary.awaitingFeedback}
            icon={MessageSquareHeart}
            hue={['text-domain-feedback', 'bg-domain-feedback/10']}
          />
        </div>
      )}

      <div className="flex w-fit rounded-md border border-border p-0.5">
        {(['upcoming', 'past'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors',
              view === v ? 'bg-primary/10 text-primary' : 'text-foreground-muted hover:text-foreground',
            )}
          >
            {v}
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
        emptyIcon={CalendarDays}
        emptyIconClass="text-domain-events"
        emptyTitle={view === 'upcoming' ? 'Nothing coming up' : 'Nothing in your history yet'}
        emptyBody={
          view === 'upcoming'
            ? "You haven't registered for any upcoming events. Browse what's on and sign up."
            : 'Events you attended or missed will show up here after they finish.'
        }
      />
    </main>
  );
}
