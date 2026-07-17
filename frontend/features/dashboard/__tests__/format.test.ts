import { describe, expect, it } from 'vitest';
import { auditActionSentence, formatCount, relativeTime } from '@/features/dashboard/format';

describe('auditActionSentence', () => {
  it('maps known actions to readable sentences', () => {
    expect(auditActionSentence('event.publish')).toBe('published an event');
    expect(auditActionSentence('member.role.change')).toBe("changed a member's role");
    expect(auditActionSentence('registration.create')).toBe('registered for an event');
    expect(auditActionSentence('certificate.upload')).toBe('uploaded a certificate');
    expect(auditActionSentence('pdpa.consent.renew')).toBe('renewed their consent');
  });

  it('humanizes unknown actions instead of leaking raw keys', () => {
    expect(auditActionSentence('gadget.frobnicate')).toBe('gadget frobnicate');
  });
});

describe('relativeTime', () => {
  it('renders recent moments as "just now"', () => {
    expect(relativeTime(new Date().toISOString())).toBe('just now');
  });

  it('renders minutes and hours', () => {
    const twoMin = new Date(Date.now() - 2 * 60_000).toISOString();
    const threeHours = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(relativeTime(twoMin)).toBe('2m ago');
    expect(relativeTime(threeHours)).toBe('3h ago');
  });

  it('renders days beyond 24h', () => {
    const twoDays = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(relativeTime(twoDays)).toBe('2d ago');
  });
});

describe('formatCount', () => {
  it('adds thousands separators', () => {
    expect(formatCount(1248)).toBe('1,248');
    expect(formatCount(0)).toBe('0');
  });
});
