import type { Member } from '@/types/api';

// GET /certificates returns raw rows with only userId, no name join —
// resolve it client-side from the already-fetched member list. A missing
// member (not possible under normal lifecycle, but not ruled out under a
// race with removal) falls back to the raw id rather than crashing.
export function resolveMemberName(userId: string, members: Member[]): string {
  const member = members.find((m) => m.userId === userId);
  return member ? member.user.fullName : userId;
}
