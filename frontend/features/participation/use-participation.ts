'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ParticipationItem } from '@/types/api';

/**
 * The caller's own registrations across every event in the org, in one
 * request. Backs the participant home, and the participant-facing views of
 * Attendance / Certificates / Feedback — all of which previously had no
 * cross-event data source and dead-ended.
 */
export function useMyParticipation(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'participation', 'me'],
    queryFn: () => api<ParticipationItem[]>(`/organizations/${orgId}/me/participation`),
  });
}
