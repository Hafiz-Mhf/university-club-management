import { describe, expect, it } from 'vitest';
import { resolveMemberName } from '@/features/certificates/resolve-member-name';
import type { Member } from '@/types/api';

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1', userId: 'u1', organizationId: 'o1', role: 'PARTICIPANT', status: 'ACTIVE',
    studentId: null, faculty: null, programme: null, intake: null, phone: null,
    committeeHistory: null, joinedAt: '2026-01-01T00:00:00Z',
    user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' },
    ...overrides,
  };
}

describe('resolveMemberName', () => {
  it('resolves the full name when a matching member is found', () => {
    expect(resolveMemberName('u1', [makeMember()])).toBe('Ada Lovelace');
  });

  it('falls back to the raw userId when no matching member exists', () => {
    expect(resolveMemberName('missing-user', [makeMember()])).toBe('missing-user');
  });
});
