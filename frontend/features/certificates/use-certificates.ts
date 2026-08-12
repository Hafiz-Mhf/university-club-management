'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiOrNull, apiUpload } from '@/lib/api';
import type { Certificate, MyCertificate } from '@/types/api';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/certificates`;
}

export function useMyCertificate(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'certificate', 'me'],
    // 404 = "no certificate yet", which is data. See apiOrNull.
    queryFn: () => apiOrNull<MyCertificate>(`${base(orgId, eventId)}/me`),
  });
}

export function useCertificateList(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'certificates'],
    queryFn: () => api<Certificate[]>(base(orgId, eventId)),
  });
}

function useInvalidateCertificates(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'certificates'] });
  };
}

export function useUploadCertificate(orgId: string, eventId: string) {
  const invalidate = useInvalidateCertificates(orgId, eventId);
  return useMutation({
    mutationFn: (formData: FormData) =>
      apiUpload<Certificate>(base(orgId, eventId), formData),
    onSuccess: invalidate,
  });
}

export function useRemoveCertificate(orgId: string, eventId: string) {
  const invalidate = useInvalidateCertificates(orgId, eventId);
  return useMutation({
    mutationFn: (certificateId: string) =>
      api<{ removed: true }>(`${base(orgId, eventId)}/${certificateId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
