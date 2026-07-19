'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload } from '@/lib/api';
import type { FileCategory, OrgFile } from '@/types/api';

function base(orgId: string) {
  return `/organizations/${orgId}/files`;
}

export function useFiles(orgId: string, category?: FileCategory) {
  return useQuery({
    queryKey: ['org', orgId, 'files', category ?? 'ALL'],
    queryFn: () => {
      const qs = category ? `?category=${category}` : '';
      return api<OrgFile[]>(`${base(orgId)}${qs}`);
    },
  });
}

function useInvalidateFiles(orgId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'files'] });
  };
}

export function useUploadFile(orgId: string) {
  const invalidate = useInvalidateFiles(orgId);
  return useMutation({
    mutationFn: (formData: FormData) => apiUpload<OrgFile>(base(orgId), formData),
    onSuccess: invalidate,
  });
}

export function useDownloadFile(orgId: string) {
  return useMutation({
    mutationFn: (fileId: string) =>
      api<{ downloadUrl: string }>(`${base(orgId)}/${fileId}/download`),
  });
}

export function useDeleteFile(orgId: string) {
  const invalidate = useInvalidateFiles(orgId);
  return useMutation({
    mutationFn: (fileId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${fileId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
