import { describe, expect, it } from 'vitest';
import { resolveUploaderName } from '../resolve-uploader-name';
import type { Member } from '@/types/api';

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    userId: 'u1',
    organizationId: 'o1',
    role: 'MEMBER',
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

describe('resolveUploaderName', () => {
  it("returns the matching member's full name", () => {
    const members = [makeMember({ userId: 'u1' })];
    expect(resolveUploaderName('u1', members)).toBe('Ada Lovelace');
  });

  it('falls back to the raw id when no member matches', () => {
    expect(resolveUploaderName('missing-id', [])).toBe('missing-id');
  });
});
