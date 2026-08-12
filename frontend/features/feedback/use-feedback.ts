'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiOrNull } from '@/lib/api';
import type { FeedbackResponse } from '@/types/api';
import type { FeedbackFormInput } from './schemas';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/feedback`;
}

export interface FeedbackSummary {
  responseCount: number;
  avgNpsScore: number | null;
  avgContentRating: number | null;
  avgOrganizationRating: number | null;
  avgVenueRating: number | null;
  comments: string[];
}

export function useMyFeedback(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'feedback', 'me'],
    // 404 = "not submitted yet", which is data. See apiOrNull.
    queryFn: () => apiOrNull<FeedbackResponse>(`${base(orgId, eventId)}/me`),
  });
}

export function useFeedbackSummary(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'feedback', 'summary'],
    queryFn: () => api<FeedbackSummary>(`${base(orgId, eventId)}/summary`),
  });
}

export function useSubmitFeedback(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FeedbackFormInput) =>
      api<FeedbackResponse>(base(orgId, eventId), { method: 'POST', body: input }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'feedback', 'me'] }),
  });
}
