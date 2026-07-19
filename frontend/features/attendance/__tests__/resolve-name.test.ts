import { describe, expect, it } from 'vitest';
import { resolveParticipantName } from '@/features/attendance/resolve-name';
import type { Attendance, Member, Registration } from '@/types/api';

function makeAttendance(overrides: Partial<Attendance> = {}): Attendance {
  return {
    id: 'a1', registrationId: 'r1', eventId: 'e1', organizationId: 'o1',
    status: 'REGISTERED', scannedAt: null, scannedBy: null, createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 'r1', eventId: 'e1', organizationId: 'o1', userId: 'u1', answers: null,
    status: 'APPROVED', consentRecordId: null, createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1', userId: 'u1', organizationId: 'o1', role: 'PARTICIPANT', status: 'ACTIVE',
    studentId: null, faculty: null, programme: null, intake: null, phone: null,
    committeeHistory: null, joinedAt: '2026-01-01T00:00:00Z',
    user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' },
    ...overrides,
  };
}

describe('resolveParticipantName', () => {
  it('resolves the full name when both the registration and member are found', () => {
    const name = resolveParticipantName(makeAttendance(), [makeRegistration()], [makeMember()]);
    expect(name).toBe('Ada Lovelace');
  });

  it('falls back to the raw registrationId when no matching registration exists', () => {
    const name = resolveParticipantName(makeAttendance({ registrationId: 'missing' }), [makeRegistration()], [makeMember()]);
    expect(name).toBe('missing');
  });

  it('falls back to the raw userId when the registration exists but no member matches', () => {
    const name = resolveParticipantName(makeAttendance(), [makeRegistration({ userId: 'orphan-user' })], [makeMember()]);
    expect(name).toBe('orphan-user');
  });
});
