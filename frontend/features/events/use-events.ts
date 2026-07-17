'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Event } from '@/types/api';
import type { EventFormInput } from '@/features/events/schemas';

function toBody(input: EventFormInput) {
  return {
    title: input.title,
    description: input.description || undefined,
    venue: input.venue || undefined,
    startAt: new Date(input.startAt).toISOString(),
    endAt: new Date(input.endAt).toISOString(),
    capacity: input.capacity ? Number(input.capacity) : undefined,
  };
}

export function useEvents(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'events'],
    queryFn: () => api<Event[]>(`/organizations/${orgId}/events`),
  });
}

export function useEvent(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId],
    queryFn: () => api<Event>(`/organizations/${orgId}/events/${eventId}`),
    retry: false, // a 404 here is a meaningful answer (DRAFT hidden), not a flake
  });
}

function useInvalidateEvents(orgId: string, eventId?: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'events'] });
    if (eventId) qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId] });
  };
}

export function useCreateEvent(orgId: string) {
  const invalidate = useInvalidateEvents(orgId);
  return useMutation({
    mutationFn: (input: EventFormInput) =>
      api<Event>(`/organizations/${orgId}/events`, { method: 'POST', body: toBody(input) }),
    onSuccess: invalidate,
  });
}

export function useUpdateEvent(orgId: string, eventId: string) {
  const invalidate = useInvalidateEvents(orgId, eventId);
  return useMutation({
    mutationFn: (input: EventFormInput) =>
      api<Event>(`/organizations/${orgId}/events/${eventId}`, {
        method: 'PATCH',
        body: toBody(input),
      }),
    onSuccess: invalidate,
  });
}

function useLifecycleAction(orgId: string, eventId: string, action: 'publish' | 'complete' | 'cancel') {
  const invalidate = useInvalidateEvents(orgId, eventId);
  return useMutation({
    mutationFn: () =>
      api<Event>(`/organizations/${orgId}/events/${eventId}/${action}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export const usePublishEvent = (orgId: string, eventId: string) =>
  useLifecycleAction(orgId, eventId, 'publish');
export const useCompleteEvent = (orgId: string, eventId: string) =>
  useLifecycleAction(orgId, eventId, 'complete');
export const useCancelEvent = (orgId: string, eventId: string) =>
  useLifecycleAction(orgId, eventId, 'cancel');

export function useDeleteEvent(orgId: string, eventId: string) {
  const invalidate = useInvalidateEvents(orgId);
  return useMutation({
    mutationFn: () =>
      api<{ removed: true }>(`/organizations/${orgId}/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
