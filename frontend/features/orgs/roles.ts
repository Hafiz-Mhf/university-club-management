import type { MembershipRole } from '@/types/api';

// Mirrors backend/src/rbac/role-groups.ts MANAGE_EVENTS — the committee tier
// that can see org-management surfaces (dashboard, member lists, analytics).
export const COMMITTEE_ROLES: MembershipRole[] = [
  'PRESIDENT',
  'VICE_PRESIDENT',
  'SECRETARY',
  'TREASURER',
  'EVENT_DIRECTOR',
  'COMMITTEE',
];

export function isCommittee(role: MembershipRole): boolean {
  return COMMITTEE_ROLES.includes(role);
}
