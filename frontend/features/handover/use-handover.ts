'use client';

import { useMutation } from '@tanstack/react-query';
import { apiDownloadBlob } from '@/lib/api';

export function useDownloadHandoverPack(orgId: string) {
  return useMutation({
    mutationFn: () => apiDownloadBlob(`/organizations/${orgId}/handover`),
  });
}
