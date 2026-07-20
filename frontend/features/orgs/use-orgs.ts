'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload } from '@/lib/api';
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

// Branding/profile changes affect both the list (org switcher, sidebar
// theme) and the detail query used by the Settings page — both are kept
// in sync on every mutation.
function useInvalidateOrg(orgId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['org', orgId] });
    queryClient.invalidateQueries({ queryKey: ['orgs'] });
  };
}

export interface OrgProfileInput {
  name?: string;
  description?: string;
  socialLinks?: Record<string, string>;
  advisors?: string[];
}

export function useUpdateOrgProfile(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: (input: OrgProfileInput) =>
      api<Organization>(`/organizations/${orgId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export interface OrgColorsInput {
  primaryColor?: string;
  secondaryColor?: string;
}

export function useUpdateOrgSettings(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: (input: OrgColorsInput) =>
      api<Organization>(`/organizations/${orgId}/settings`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useUploadLogo(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: (formData: FormData) => apiUpload<Organization>(`/organizations/${orgId}/logo`, formData),
    onSuccess: invalidate,
  });
}

export function useDeleteLogo(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: () => api<Organization>(`/organizations/${orgId}/logo`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useUploadBanner(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: (formData: FormData) => apiUpload<Organization>(`/organizations/${orgId}/banner`, formData),
    onSuccess: invalidate,
  });
}

export function useDeleteBanner(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: () => api<Organization>(`/organizations/${orgId}/banner`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
