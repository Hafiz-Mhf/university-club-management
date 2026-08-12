'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiOrNull } from '@/lib/api';
import type { Attendance, MyAttendance } from '@/types/api';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/attendance`;
}

export function useMyAttendance(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'attendance', 'me'],
    // 404 = "no attendance row", which is data. See apiOrNull.
    queryFn: () => apiOrNull<MyAttendance>(`${base(orgId, eventId)}/me`),
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
