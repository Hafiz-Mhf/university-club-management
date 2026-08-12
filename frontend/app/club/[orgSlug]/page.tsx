'use client';

import { use } from 'react';
import { Building2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList } from '@/components/ui/skeleton-list';
import { PublicProfileHero } from '@/components/public/public-profile-hero';
import { PublicUpcomingEvents } from '@/components/public/public-upcoming-events';
import { PublicGalleryGrid } from '@/components/public/public-gallery-grid';
import { PublicAchievementsList } from '@/components/public/public-achievements-list';
import { usePublicProfile } from '@/features/public/use-public-club';

function ClubNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
        <Building2 className="size-5 text-foreground-muted" />
      </div>
      <h1 className="text-xl font-semibold">Club not found</h1>
      <p className="text-sm text-foreground-muted">
        This page may have moved, or the club no longer exists.
      </p>
    </div>
  );
}

export default function PublicClubPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = use(params);
  const profile = usePublicProfile(orgSlug);

  // Public page — first paint for a visitor with no session, so a blank frame
  // here reads as a broken link rather than a load.
  if (profile.isPending) {
    return (
      <div className="flex min-h-dvh flex-col gap-8 pb-8">
        <Skeleton role="status" aria-label="Loading club page" className="h-56 w-full rounded-none" />
        <div className="mx-auto w-full max-w-4xl px-4">
          <SkeletonList rows={3} rowClassName="h-20" className="gap-3" label="Loading club page" />
        </div>
      </div>
    );
  }
  if (profile.isError || !profile.data) return <ClubNotFound />;

  return (
    <div className="flex min-h-dvh flex-col gap-8 pb-8">
      <PublicProfileHero profile={profile.data} />
      <PublicUpcomingEvents events={profile.data.upcomingEvents} />
      <PublicGalleryGrid orgSlug={orgSlug} />
      <PublicAchievementsList orgSlug={orgSlug} />
    </div>
  );
}
