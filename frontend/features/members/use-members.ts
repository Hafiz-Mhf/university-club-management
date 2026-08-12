'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Member, MemberStatus, MembershipRole } from '@/types/api';

interface MemberFilters {
  status?: MemberStatus;
  role?: MembershipRole;
}

function base(orgId: string) {
  return `/organizations/${orgId}/members`;
}

function queryString(filters: MemberFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.role) params.set('role', filters.role);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useMembers(orgId: string, filters: MemberFilters = {}) {
  return useQuery({
    queryKey: ['org', orgId, 'members', filters],
    queryFn: () => api<Member[]>(`${base(orgId)}${queryString(filters)}`),
    // Changing a filter changes the key, which would otherwise drop the list
    // back to `isPending` and swap the loaded rows for a skeleton. Hold the
    // previous rows and let the caller show a refresh cue instead.
    placeholderData: keepPreviousData,
  });
}

function useInvalidateMembers(orgId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'members'] });
    // The caller may have edited their own row — keep the shell/dashboard
    // role branch (useMyMembership's ['org', orgId, 'me'] key) current.
    qc.invalidateQueries({ queryKey: ['org', orgId, 'me'] });
  };
}

export interface AddMemberInput {
  email: string;
  role: MembershipRole;
  studentId?: string;
  faculty?: string;
  programme?: string;
  intake?: string;
  phone?: string;
}

export function useAddMember(orgId: string) {
  const invalidate = useInvalidateMembers(orgId);
  return useMutation({
    mutationFn: (input: AddMemberInput) =>
      api<Member>(base(orgId), { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export interface UpdateMemberInput {
  status?: MemberStatus;
  studentId?: string;
  faculty?: string;
  programme?: string;
  intake?: string;
  phone?: string;
}

export function useUpdateMember(orgId: string, membershipId: string) {
  const invalidate = useInvalidateMembers(orgId);
  return useMutation({
    mutationFn: (input: UpdateMemberInput) =>
      api<Member>(`${base(orgId)}/${membershipId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useChangeRole(orgId: string, membershipId: string) {
  const invalidate = useInvalidateMembers(orgId);
  return useMutation({
    mutationFn: (role: MembershipRole) =>
      api<Member>(`${base(orgId)}/${membershipId}/role`, { method: 'PATCH', body: { role } }),
    onSuccess: invalidate,
  });
}

export function useRemoveMember(orgId: string) {
  const invalidate = useInvalidateMembers(orgId);
  return useMutation({
    mutationFn: (membershipId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${membershipId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
