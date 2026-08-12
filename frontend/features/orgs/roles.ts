import type { MembershipRole } from '@/types/api';

/** Human-readable role name, shared by every surface that names a role. */
export const ROLE_LABELS: Record<MembershipRole, string> = {
  PRESIDENT: 'President',
  VICE_PRESIDENT: 'Vice President',
  SECRETARY: 'Secretary',
  TREASURER: 'Treasurer',
  EVENT_DIRECTOR: 'Event Director',
  COMMITTEE: 'Committee',
  VOLUNTEER: 'Volunteer',
  PARTICIPANT: 'Participant',
  ADVISOR: 'Advisor',
};

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

// Mirrors backend MANAGE_ATTENDANCE (MANAGE_EVENTS + VOLUNTEER) — the
// first role group in this frontend that gives VOLUNTEER any capability.
export const MANAGE_ATTENDANCE_ROLES: MembershipRole[] = [...COMMITTEE_ROLES, 'VOLUNTEER'];

export function canManageAttendance(role: MembershipRole): boolean {
  return MANAGE_ATTENDANCE_ROLES.includes(role);
}

// Mirrors backend OrganizationsController's `@Roles('PRESIDENT', 'VICE_PRESIDENT')`
// on profile/logo/banner endpoints — identical role set to MANAGE_ROLES_ROLES
// above, reused rather than duplicated, but named for this feature's own
// call sites so intent stays clear at each usage.
export function canManageOrgProfile(role: MembershipRole): boolean {
  return MANAGE_ROLES_ROLES.includes(role);
}

// Mirrors backend's `@Roles('PRESIDENT')` on PATCH .../settings — one tier
// stricter than canManageOrgProfile.
const ORG_COLORS_ROLES: MembershipRole[] = ['PRESIDENT'];

export function canManageOrgColors(role: MembershipRole): boolean {
  return ORG_COLORS_ROLES.includes(role);
}
