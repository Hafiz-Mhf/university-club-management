import type { Attendance, Member, Registration } from '@/types/api';

// Neither GET /attendance nor GET /registrations joins a participant's
// name — resolve it client-side from two already-fetched lists. A missing
// registration or member (shouldn't happen given the lifecycle guarantees,
// but not impossible under a race) falls back to a raw id rather than
// crashing or hiding the row.
export function resolveParticipantName(
  attendance: Attendance,
  registrations: Registration[],
  members: Member[],
): string {
  const registration = registrations.find((r) => r.id === attendance.registrationId);
  if (!registration) return attendance.registrationId;
  const member = members.find((m) => m.userId === registration.userId);
  if (!member) return registration.userId;
  return member.user.fullName;
}
