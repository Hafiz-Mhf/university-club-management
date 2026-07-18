'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Registration } from '@/types/api';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/registrations`;
}

export function useMyRegistration(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'registration', 'me'],
    queryFn: () => api<Registration | null>(`${base(orgId, eventId)}/me`),
  });
}

export function useRegistrations(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'registrations'],
    queryFn: () => api<Registration[]>(base(orgId, eventId)),
  });
}

function useInvalidateRegistrations(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'registrations'] });
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'registration', 'me'] });
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId] });
  };
}

export function useRegisterForEvent(orgId: string, eventId: string) {
  const invalidate = useInvalidateRegistrations(orgId, eventId);
  return useMutation({
    mutationFn: (answers: Record<string, string | string[]> | undefined) =>
      api<Registration>(base(orgId, eventId), {
        method: 'POST',
        body: answers && Object.keys(answers).length > 0 ? { answers } : {},
      }),
    onSuccess: invalidate,
  });
}

export function useCancelRegistration(orgId: string, eventId: string) {
  const invalidate = useInvalidateRegistrations(orgId, eventId);
  return useMutation({
    mutationFn: (registrationId: string) =>
      api<Registration>(`${base(orgId, eventId)}/${registrationId}/cancel`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRejectRegistration(orgId: string, eventId: string) {
  const invalidate = useInvalidateRegistrations(orgId, eventId);
  return useMutation({
    mutationFn: (registrationId: string) =>
      api<Registration>(`${base(orgId, eventId)}/${registrationId}/reject`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
