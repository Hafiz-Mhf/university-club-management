'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ConsentRecordItem } from '@/types/api';

export function useConsents() {
  return useQuery({
    queryKey: ['me', 'consents'],
    queryFn: () => api<ConsentRecordItem[]>('/me/consents'),
  });
}

// The export is a synchronous, non-persisted JSON blob (no signed URL, no
// storage row) — modeled as a mutation (triggered on click, not cached)
// rather than a query.
export function useExportData() {
  return useMutation({
    mutationFn: () => api<Record<string, unknown>>('/me/export'),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => api<void>('/me', { method: 'DELETE' }),
  });
}
