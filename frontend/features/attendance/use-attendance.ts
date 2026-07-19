'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Attendance, MyAttendance } from '@/types/api';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/attendance`;
}

export function useMyAttendance(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'attendance', 'me'],
    queryFn: () => api<MyAttendance>(`${base(orgId, eventId)}/me`),
    retry: false, // a 404 here is a meaningful answer (no attendance row), not a flake
  });
}

export function useAttendanceList(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'attendance'],
    queryFn: () => api<Attendance[]>(base(orgId, eventId)),
  });
}

function useInvalidateAttendance(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'attendance'] });
  };
}

export function useScanAttendance(orgId: string, eventId: string) {
  const invalidate = useInvalidateAttendance(orgId, eventId);
  return useMutation({
    mutationFn: (token: string) =>
      api<Attendance>(`${base(orgId, eventId)}/scan`, { method: 'POST', body: { token } }),
    onSuccess: invalidate,
  });
}

export function useMarkAbsent(orgId: string, eventId: string) {
  const invalidate = useInvalidateAttendance(orgId, eventId);
  return useMutation({
    mutationFn: (attendanceId: string) =>
      api<Attendance>(`${base(orgId, eventId)}/${attendanceId}/absent`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
