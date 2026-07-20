'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Achievement } from '@/types/api';

function base(orgId: string) {
  return `/organizations/${orgId}/achievements`;
}

export function useAchievements(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'achievements'],
    queryFn: () => api<Achievement[]>(base(orgId)),
  });
}

function useInvalidateAchievements(orgId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['org', orgId, 'achievements'] });
}

export interface AchievementInput {
  title: string;
  description: string;
  year: number;
}

export function useCreateAchievement(orgId: string) {
  const invalidate = useInvalidateAchievements(orgId);
  return useMutation({
    mutationFn: (input: AchievementInput) =>
      api<Achievement>(base(orgId), { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateAchievement(orgId: string) {
  const invalidate = useInvalidateAchievements(orgId);
  return useMutation({
    mutationFn: ({ achievementId, input }: { achievementId: string; input: AchievementInput }) =>
      api<Achievement>(`${base(orgId)}/${achievementId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useRemoveAchievement(orgId: string) {
  const invalidate = useInvalidateAchievements(orgId);
  return useMutation({
    mutationFn: (achievementId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${achievementId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
