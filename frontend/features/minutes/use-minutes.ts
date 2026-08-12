'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AgendaItem, MeetingMinutes } from '@/types/api';

function base(orgId: string) {
  return `/organizations/${orgId}/minutes`;
}

export interface MinutesListResponse {
  data: MeetingMinutes[];
  total: number;
  page: number;
  pageSize: number;
}

export function useMinutesList(orgId: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: ['org', orgId, 'minutes', 'list', page, pageSize],
    queryFn: () => api<MinutesListResponse>(`${base(orgId)}?page=${page}&pageSize=${pageSize}`),
    // Paging keeps the current page visible instead of collapsing the table to
    // a skeleton on every click.
    placeholderData: keepPreviousData,
  });
}

export function useMinutes(orgId: string, minutesId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'minutes', minutesId],
    queryFn: () => api<MeetingMinutes>(`${base(orgId)}/${minutesId}`),
    retry: false, // a 404 here is a meaningful answer, not a flake
  });
}

function useInvalidateMinutes(orgId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'minutes'] });
  };
}

export interface MinutesInput {
  title: string;
  meetingDate: string;
  attendeeMembershipIds: string[];
  agendaItems: AgendaItem[];
  actionItems: { task: string; owner?: string }[];
}

export function useCreateMinutes(orgId: string) {
  const invalidate = useInvalidateMinutes(orgId);
  return useMutation({
    mutationFn: (input: MinutesInput) =>
      api<MeetingMinutes>(base(orgId), { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateMinutes(orgId: string) {
  const invalidate = useInvalidateMinutes(orgId);
  return useMutation({
    mutationFn: ({ minutesId, input }: { minutesId: string; input: MinutesInput }) =>
      api<MeetingMinutes>(`${base(orgId)}/${minutesId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteMinutes(orgId: string) {
  const invalidate = useInvalidateMinutes(orgId);
  return useMutation({
    mutationFn: (minutesId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${minutesId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
