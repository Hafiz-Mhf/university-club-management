import type { Member } from '@/types/api';

// OrgFile rows carry uploadedByUserId directly (same shape as
// Certificate.userId) — resolve client-side from the already-fetched
// member list. Falls back to the raw id on a miss rather than crashing.
export function resolveUploaderName(uploadedByUserId: string, members: Member[]): string {
  const member = members.find((m) => m.userId === uploadedByUserId);
  return member ? member.user.fullName : uploadedByUserId;
}
