'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Refreshing } from '@/components/ui/refreshing';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGallery, useRemovePhoto } from '@/features/gallery/use-gallery';
import { relativeTime } from '@/features/dashboard/format';

export function GalleryGrid({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const gallery = useGallery(orgId);
  const remove = useRemovePhoto(orgId);
  const [removing, setRemoving] = useState<string | null>(null);

  if (gallery.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Skeleton className="aspect-square w-full" />
        <Skeleton className="aspect-square w-full" />
        <Skeleton className="aspect-square w-full" />
      </div>
    );
  }
  if (gallery.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load photos.</p>;
  }
  if (gallery.data.length === 0) {
    return <p className="py-8 text-center text-sm text-foreground-muted">No photos yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Refreshing
        active={gallery.isFetching}
        label="Refreshing photos"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        {gallery.data.map((photo) => (
          <div key={photo.id} className="flex flex-col gap-1.5">
            <div className="aspect-square overflow-hidden rounded-md bg-surface-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here */}
              <img src={photo.downloadUrl} alt={photo.caption ?? 'Gallery photo'} className="h-full w-full object-cover" />
            </div>
            <p className="text-xs text-foreground-muted">{photo.caption}</p>
            <p className="text-xs text-foreground-subtle">{relativeTime(photo.createdAt)}</p>
            {canManage && (
              <Button variant="destructive" size="sm" onClick={() => setRemoving(photo.id)}>
                Remove
              </Button>
            )}
          </div>
        ))}
      </Refreshing>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove photo?</DialogTitle>
            <DialogDescription>This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing, { onSuccess: () => setRemoving(null) });
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
