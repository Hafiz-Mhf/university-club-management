import { Building2 } from 'lucide-react';
import type { PublicProfile } from '@/types/api';

export function PublicProfileHero({ profile }: { profile: PublicProfile }) {
  const socialEntries = Object.entries(profile.socialLinks ?? {});
  const advisors = profile.advisors ?? [];

  return (
    <div className="flex flex-col">
      <div className="h-48 w-full overflow-hidden bg-surface-secondary sm:h-64">
        {profile.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here
          <img src={profile.bannerUrl} alt={`${profile.name} banner`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Building2 className="size-10 text-foreground-subtle" />
          </div>
        )}
      </div>

      <div className="mx-auto -mt-10 flex w-full max-w-3xl flex-col gap-3 px-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border-4 border-surface bg-surface-secondary">
          {profile.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here
            <img src={profile.logoUrl} alt={`${profile.name} logo`} className="h-full w-full object-cover" />
          ) : (
            <Building2 className="size-6 text-foreground-subtle" />
          )}
        </div>

        <h1 className="text-2xl font-semibold">{profile.name}</h1>
        {profile.description && <p className="text-sm text-foreground-muted">{profile.description}</p>}

        {socialEntries.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {socialEntries.map(([key, value]) => (
              <a key={key} href={value} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                {key}
              </a>
            ))}
          </div>
        )}

        {advisors.length > 0 && (
          <div>
            <h2 className="text-sm font-medium">Advisors</h2>
            <ul className="list-inside list-disc text-sm text-foreground-muted">
              {advisors.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
