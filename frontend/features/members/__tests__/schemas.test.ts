import { describe, expect, it } from 'vitest';
import { addMemberSchema, editMemberSchema } from '@/features/members/schemas';

describe('addMemberSchema', () => {
  const base = { email: 'a@example.com', role: 'VOLUNTEER' as const };

  it('accepts a minimal valid input', () => {
    expect(addMemberSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const r = addMemberSchema.safeParse({ ...base, email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('requires a role', () => {
    const r = addMemberSchema.safeParse({ email: base.email });
    expect(r.success).toBe(false);
  });

  it('accepts all optional profile fields blank', () => {
    const full = { ...base, studentId: '', faculty: '', programme: '', intake: '', phone: '' };
    expect(addMemberSchema.safeParse(full).success).toBe(true);
  });

  it('accepts all optional profile fields filled', () => {
    const full = {
      ...base, studentId: 'S123', faculty: 'Engineering', programme: 'CS',
      intake: '2026', phone: '+60123456789',
    };
    expect(addMemberSchema.safeParse(full).success).toBe(true);
  });
});

describe('editMemberSchema', () => {
  const base = { status: 'ACTIVE' as const };

  it('accepts status alone', () => {
    expect(editMemberSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an invalid status value', () => {
    const r = editMemberSchema.safeParse({ status: 'SUSPENDED' });
    expect(r.success).toBe(false);
  });

  it('accepts ALUMNI as a valid status', () => {
    expect(editMemberSchema.safeParse({ status: 'ALUMNI' }).success).toBe(true);
  });

  it('has no role or email field in its shape', () => {
    const parsed = editMemberSchema.safeParse({ ...base, role: 'PRESIDENT', email: 'x@example.com' });
    // Zod strips unknown keys by default (non-strict) — the parsed output
    // must not carry them through, mirroring the backend DTO's structural
    // safety (UpdateMemberDto has no role/email field at all).
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('role' in parsed.data).toBe(false);
      expect('email' in parsed.data).toBe(false);
    }
  });
});
