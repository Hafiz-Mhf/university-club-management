'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MyMembership, Organization } from '@/types/api';

export function useOrgs() {
  return useQuery({
    queryKey: ['orgs'],
    queryFn: () => api<Organization[]>('/organizations'),
  });
}

/** Full org detail — resolves signed logoUrl/bannerUrl, unlike the list. */
export function useOrgDetail(orgId: string | undefined) {
  return useQuery({
    queryKey: ['org', orgId],
    queryFn: () => api<Organization>(`/organizations/${orgId}`),
    enabled: !!orgId,
  });
}

export function useMyMembership(orgId: string | undefined) {
  return useQuery({
    queryKey: ['org', orgId, 'me'],
    queryFn: () => api<MyMembership>(`/organizations/${orgId}/members/me`),
    enabled: !!orgId,
  });
}

export function useCreateOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      api<Organization>('/organizations', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orgs'] }),
  });
}
