import type { Member } from '@/types/api';

// attendeeMembershipIds holds Membership.id values, not userId — matches
// member.id, unlike resolveMemberName/resolveUploaderName which match
// member.userId. Falls back to the raw id on a genuine miss.
export function resolveAttendeeNames(attendeeMembershipIds: string[], members: Member[]): string[] {
  return attendeeMembershipIds.map((id) => {
    const member = members.find((m) => m.id === id);
    return member ? member.user.fullName : id;
  });
}
