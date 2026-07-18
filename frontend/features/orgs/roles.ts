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

// Mirrors backend MANAGE_MEMBERS — the stricter tier (no COMMITTEE) that
// gates destructive event actions (cancel/delete) and member management.
export const MANAGE_MEMBERS_ROLES: MembershipRole[] = [
  'PRESIDENT',
  'VICE_PRESIDENT',
  'SECRETARY',
  'TREASURER',
  'EVENT_DIRECTOR',
];

export function canManageMembers(role: MembershipRole): boolean {
  return MANAGE_MEMBERS_ROLES.includes(role);
}

// Mirrors backend MANAGE_ROLES — President/VP only, gates role changes and
// removal (stricter than MANAGE_MEMBERS, which excludes only COMMITTEE).
export const MANAGE_ROLES_ROLES: MembershipRole[] = ['PRESIDENT', 'VICE_PRESIDENT'];

export function canManageRoles(role: MembershipRole): boolean {
  return MANAGE_ROLES_ROLES.includes(role);
}
