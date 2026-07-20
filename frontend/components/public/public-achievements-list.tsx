'use client';

import { Trophy } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { usePublicAchievements } from '@/features/public/use-public-club';

export function PublicAchievementsList({ orgSlug }: { orgSlug: string }) {
  const achievements = usePublicAchievements(orgSlug);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-12">
      <h2 className="text-lg font-medium">Achievements</h2>
      {achievements.isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {achievements.isError && <p className="text-sm text-foreground-muted">Couldn&apos;t load achievements.</p>}
      {achievements.data && achievements.data.length === 0 && (
        <p className="text-sm text-foreground-muted">No achievements yet.</p>
      )}
      {achievements.data && achievements.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {achievements.data.map((a) => (
            <li key={a.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Trophy className="mt-0.5 size-4 shrink-0 text-domain-certificates" />
              <div>
                <p className="text-sm font-medium">
                  {a.title} <span className="text-foreground-muted">— {a.year}</span>
                </p>
                <p className="text-sm text-foreground-muted">{a.description}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
