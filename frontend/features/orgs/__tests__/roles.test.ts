import { describe, expect, it } from 'vitest';
import { canManageMembers, canManageRoles, isCommittee } from '@/features/orgs/roles';
import type { MembershipRole } from '@/types/api';

const ALL: MembershipRole[] = [
  'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
  'COMMITTEE', 'VOLUNTEER', 'PARTICIPANT', 'ADVISOR',
];

describe('isCommittee', () => {
  it('is true for MANAGE_EVENTS tier, false otherwise', () => {
    const expected: Record<MembershipRole, boolean> = {
      PRESIDENT: true, VICE_PRESIDENT: true, SECRETARY: true, TREASURER: true,
      EVENT_DIRECTOR: true, COMMITTEE: true, VOLUNTEER: false, PARTICIPANT: false,
      ADVISOR: false,
    };
    for (const role of ALL) expect(isCommittee(role)).toBe(expected[role]);
  });
});

describe('canManageMembers', () => {
  it('is true only for the stricter MANAGE_MEMBERS tier (excludes COMMITTEE)', () => {
    const expected: Record<MembershipRole, boolean> = {
      PRESIDENT: true, VICE_PRESIDENT: true, SECRETARY: true, TREASURER: true,
      EVENT_DIRECTOR: true, COMMITTEE: false, VOLUNTEER: false, PARTICIPANT: false,
      ADVISOR: false,
    };
    for (const role of ALL) expect(canManageMembers(role)).toBe(expected[role]);
  });
});

describe('canManageRoles', () => {
  it('is true only for PRESIDENT and VICE_PRESIDENT', () => {
    const expected: Record<MembershipRole, boolean> = {
      PRESIDENT: true, VICE_PRESIDENT: true, SECRETARY: false, TREASURER: false,
      EVENT_DIRECTOR: false, COMMITTEE: false, VOLUNTEER: false, PARTICIPANT: false,
      ADVISOR: false,
    };
    for (const role of ALL) expect(canManageRoles(role)).toBe(expected[role]);
  });
});
