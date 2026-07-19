import { describe, expect, it } from 'vitest';
import { resolveAttendeeNames } from '../resolve-attendee-names';
import type { Member } from '@/types/api';

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    userId: 'u1',
    organizationId: 'o1',
    role: 'PARTICIPANT',
    status: 'ACTIVE',
    studentId: null,
    faculty: null,
    programme: null,
    intake: null,
    phone: null,
    committeeHistory: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' },
    ...overrides,
  };
}

describe('resolveAttendeeNames', () => {
  it('resolves each membership id to its full name', () => {
    const members = [
      makeMember({ id: 'm1', user: { id: 'u1', fullName: 'Ada Lovelace', email: 'a@x.io' } }),
      makeMember({ id: 'm2', userId: 'u2', user: { id: 'u2', fullName: 'Grace Hopper', email: 'g@x.io' } }),
    ];
    expect(resolveAttendeeNames(['m1', 'm2'], members)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('falls back to the raw id when a membership id has no match', () => {
    expect(resolveAttendeeNames(['missing-id'], [])).toEqual(['missing-id']);
  });

  it('returns an empty array for no attendees', () => {
    expect(resolveAttendeeNames([], [])).toEqual([]);
  });
});
