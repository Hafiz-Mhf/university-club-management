'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Registration, RegistrationWithUser } from '@/types/api';

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
    queryFn: () => api<RegistrationWithUser[]>(base(orgId, eventId)),
  });
}

function useInvalidateRegistrations(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'registrations'] });
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'registration', 'me'] });
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId] });
    // The events list carries approved/waitlisted headcounts, and the dashboard
    // surfaces the waitlist — both go stale the moment a status changes.
    qc.invalidateQueries({ queryKey: ['org', orgId, 'events'] });
    qc.invalidateQueries({ queryKey: ['org', orgId, 'dashboard'] });
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

/**
 * Committee-side promotion: waitlisted → approved, or undoing a mistaken
 * rejection. The backend refuses (409) when the event is already at capacity,
 * and its message names the way out, so it is surfaced verbatim.
 */
export function useApproveRegistration(orgId: string, eventId: string) {
  const invalidate = useInvalidateRegistrations(orgId, eventId);
  return useMutation({
    mutationFn: (registrationId: string) =>
      api<Registration>(`${base(orgId, eventId)}/${registrationId}/approve`, { method: 'POST' }),
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
