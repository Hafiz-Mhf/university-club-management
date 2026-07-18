'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { FormField, RegistrationForm } from '@/types/api';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/registration-form`;
}

export function useRegistrationForm(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'registration-form'],
    queryFn: () => api<RegistrationForm | null>(base(orgId, eventId)),
  });
}

export function useUpsertRegistrationForm(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: FormField[]) =>
      api<RegistrationForm>(base(orgId, eventId), { method: 'PUT', body: { fields } }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'registration-form'] }),
  });
}

export function useDeleteRegistrationForm(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ removed: true }>(base(orgId, eventId), { method: 'DELETE' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'registration-form'] }),
  });
}
