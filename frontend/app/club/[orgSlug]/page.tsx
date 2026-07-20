'use client';

import { use } from 'react';
import { Building2 } from 'lucide-react';
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

  if (profile.isPending) return null;
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
