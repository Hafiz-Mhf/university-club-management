'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Refreshing } from '@/components/ui/refreshing';
import { SkeletonList } from '@/components/ui/skeleton-list';
import { ParticipationRow } from '@/components/participation/participation-row';
import type { ParticipationItem } from '@/types/api';
import { cn } from '@/lib/utils';

interface ParticipationListProps {
  items: ParticipationItem[] | undefined;
  isPending: boolean;
  /** True while the list already on screen is being re-fetched. */
  isRefreshing?: boolean;
  isError: boolean;
  onRetry: () => void;
  orgSlug: string;
  now: Date;
  /** Shown when the participant genuinely has nothing here yet. */
  emptyIcon: LucideIcon;
  emptyIconClass?: string;
  emptyTitle: string;
  emptyBody: string;
  showAttendance?: boolean;
}

/**
 * The one list every participant-facing surface renders — home, attendance,
 * certificates, feedback — differing only in how the caller filtered `items`
 * and what the empty state teaches. Keeps loading, error and empty handling
 * identical across all four, which they previously did not have at all.
 */
export function ParticipationList({
  items,
  isPending,
  isRefreshing = false,
  isError,
  onRetry,
  orgSlug,
  now,
  emptyIcon: EmptyIcon,
  emptyIconClass,
  emptyTitle,
  emptyBody,
  showAttendance = true,
}: ParticipationListProps) {
  if (isPending) {
    return <SkeletonList rows={3} rowClassName="h-24" className="gap-3" label="Loading your events" />;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-foreground-muted">Couldn&apos;t load your events.</p>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
          <EmptyIcon className={cn('size-5', emptyIconClass ?? 'text-foreground-muted')} />
        </div>
        <p className="font-medium">{emptyTitle}</p>
        <p className="max-w-sm text-sm text-foreground-muted">{emptyBody}</p>
        <Link href={`/${orgSlug}/events`} className={buttonVariants({ variant: 'secondary' })}>
          Browse events
        </Link>
      </div>
    );
  }

  return (
    <Refreshing active={isRefreshing} label="Refreshing your events" className="flex flex-col gap-3">
      {items.map((item) => (
        <ParticipationRow
          key={item.registrationId}
          item={item}
          orgSlug={orgSlug}
          now={now}
          showAttendance={showAttendance}
        />
      ))}
    </Refreshing>
  );
}
