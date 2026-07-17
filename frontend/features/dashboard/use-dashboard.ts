'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardSummary } from '@/types/api';

export function useDashboard(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['org', orgId, 'dashboard'],
    queryFn: () => api<DashboardSummary>(`/organizations/${orgId}/dashboard`),
    enabled,
  });
}
