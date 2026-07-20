'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { usePublicGallery } from '@/features/public/use-public-club';

export function PublicGalleryGrid({ orgSlug }: { orgSlug: string }) {
  const gallery = usePublicGallery(orgSlug);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4">
      <h2 className="text-lg font-medium">Gallery</h2>
      {gallery.isPending && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="aspect-square w-full" />
        </div>
      )}
      {gallery.isError && <p className="text-sm text-foreground-muted">Couldn&apos;t load photos.</p>}
      {gallery.data && gallery.data.length === 0 && (
        <p className="text-sm text-foreground-muted">No photos yet.</p>
      )}
      {gallery.data && gallery.data.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {gallery.data.map((photo) => (
            <a
              key={photo.id}
              href={photo.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="block aspect-square overflow-hidden rounded-md bg-surface-secondary"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here */}
              <img src={photo.downloadUrl} alt={photo.caption ?? 'Gallery photo'} className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
