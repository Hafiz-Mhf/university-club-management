'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload } from '@/lib/api';
import type { GalleryPhoto } from '@/types/api';

function base(orgId: string) {
  return `/organizations/${orgId}/gallery`;
}

export function useGallery(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'gallery'],
    queryFn: () => api<GalleryPhoto[]>(base(orgId)),
  });
}

function useInvalidateGallery(orgId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['org', orgId, 'gallery'] });
}

export function useUploadPhoto(orgId: string) {
  const invalidate = useInvalidateGallery(orgId);
  return useMutation({
    mutationFn: (formData: FormData) => apiUpload<GalleryPhoto>(base(orgId), formData),
    onSuccess: invalidate,
  });
}

export function useRemovePhoto(orgId: string) {
  const invalidate = useInvalidateGallery(orgId);
  return useMutation({
    mutationFn: (photoId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${photoId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
