'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PublicAchievement, PublicGalleryPhoto, PublicProfile } from '@/types/api';

export function usePublicProfile(orgSlug: string) {
  return useQuery({
    queryKey: ['public', orgSlug, 'profile'],
    queryFn: () => api<PublicProfile>(`/public/organizations/${orgSlug}/profile`, { auth: false }),
    retry: false, // a 404 here is a meaningful "no such club" answer, not a flake
  });
}

export function usePublicGallery(orgSlug: string) {
  return useQuery({
    queryKey: ['public', orgSlug, 'gallery'],
    queryFn: () => api<PublicGalleryPhoto[]>(`/public/organizations/${orgSlug}/gallery`, { auth: false }),
  });
}

export function usePublicAchievements(orgSlug: string) {
  return useQuery({
    queryKey: ['public', orgSlug, 'achievements'],
    queryFn: () => api<PublicAchievement[]>(`/public/organizations/${orgSlug}/achievements`, { auth: false }),
  });
}
