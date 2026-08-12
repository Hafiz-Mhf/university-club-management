import { describe, expect, it } from 'vitest';
import {
  isActive,
  isUpcoming,
  nextAction,
  statusExplanation,
  summarize,
} from '@/features/participation/status';
import type { ParticipationItem } from '@/types/api';

const NOW = new Date('2026-06-01T00:00:00Z');

function makeItem(overrides: Partial<ParticipationItem> = {}): ParticipationItem {
  return {
    registrationId: 'r1',
    status: 'APPROVED',
    registeredAt: '2026-05-01T00:00:00Z',
    event: {
      id: 'e1',
      title: 'Intro to Robotics',
      startAt: '2026-06-10T00:00:00Z',
      endAt: '2026-06-11T00:00:00Z',
      venue: 'Lab 2',
      status: 'PUBLISHED',
    },
    attendance: { status: 'REGISTERED', scannedAt: null },
    hasCertificate: false,
    feedbackSubmitted: false,
    ...overrides,
  };
}

describe('statusExplanation', () => {
  it('explains what waitlisted means and what happens next', () => {
    expect(statusExplanation('WAITLISTED')).toMatch(/email you if a spot opens/i);
  });

  it('explains a rejection', () => {
    expect(statusExplanation('REJECTED')).toMatch(/did not accept/i);
  });

  it('stays silent for statuses the badge already conveys', () => {
    expect(statusExplanation('APPROVED')).toBeNull();
    expect(statusExplanation('CANCELLED')).toBeNull();
  });
});

describe('isActive', () => {
  it('counts approved and waitlisted as still held', () => {
    expect(isActive(makeItem({ status: 'APPROVED' }))).toBe(true);
    expect(isActive(makeItem({ status: 'WAITLISTED' }))).toBe(true);
  });

  it('excludes resolved registrations', () => {
    expect(isActive(makeItem({ status: 'CANCELLED' }))).toBe(false);
    expect(isActive(makeItem({ status: 'REJECTED' }))).toBe(false);
  });
});

describe('isUpcoming', () => {
  it('is true when the event has not started yet', () => {
    expect(isUpcoming(makeItem(), NOW)).toBe(true);
  });

  it('is false once the start time has passed', () => {
    const past = makeItem({
      event: { ...makeItem().event, startAt: '2026-05-01T00:00:00Z', endAt: '2026-05-02T00:00:00Z' },
    });
    expect(isUpcoming(past, NOW)).toBe(false);
  });
});

describe('nextAction', () => {
  it('asks an approved, not-yet-scanned participant for their check-in code', () => {
    expect(nextAction(makeItem(), NOW)).toBe('show-qr');
  });

  it('asks for feedback once they were marked present', () => {
    const present = makeItem({ attendance: { status: 'PRESENT', scannedAt: '2026-06-10T01:00:00Z' } });
    expect(nextAction(present, NOW)).toBe('give-feedback');
  });

  it('stops asking for feedback once it was submitted', () => {
    const done = makeItem({
      attendance: { status: 'PRESENT', scannedAt: '2026-06-10T01:00:00Z' },
      feedbackSubmitted: true,
    });
    expect(nextAction(done, NOW)).toBeNull();
  });

  it('prioritises an available certificate over everything else', () => {
    const certified = makeItem({
      attendance: { status: 'PRESENT', scannedAt: '2026-06-10T01:00:00Z' },
      hasCertificate: true,
    });
    expect(nextAction(certified, NOW)).toBe('download-certificate');
  });

  it('has nothing to ask of a waitlisted participant', () => {
    expect(nextAction(makeItem({ status: 'WAITLISTED', attendance: null }), NOW)).toBeNull();
  });

  it('does not offer a check-in code for an event that already ended', () => {
    const over = makeItem({
      event: { ...makeItem().event, startAt: '2026-05-01T00:00:00Z', endAt: '2026-05-02T00:00:00Z' },
    });
    expect(nextAction(over, NOW)).toBeNull();
  });
});

describe('summarize', () => {
  it('counts upcoming, attended, certificates and pending feedback', () => {
    const items = [
      makeItem(),
      makeItem({
        registrationId: 'r2',
        attendance: { status: 'PRESENT', scannedAt: '2026-05-02T01:00:00Z' },
        event: { ...makeItem().event, id: 'e2', startAt: '2026-05-01T00:00:00Z', endAt: '2026-05-02T00:00:00Z' },
      }),
      makeItem({
        registrationId: 'r3',
        attendance: { status: 'PRESENT', scannedAt: '2026-05-02T01:00:00Z' },
        hasCertificate: true,
        feedbackSubmitted: true,
        event: { ...makeItem().event, id: 'e3', startAt: '2026-05-01T00:00:00Z', endAt: '2026-05-02T00:00:00Z' },
      }),
      makeItem({ registrationId: 'r4', status: 'CANCELLED', attendance: null }),
    ];

    expect(summarize(items, NOW)).toEqual({
      upcoming: 1,
      attended: 2,
      certificates: 1,
      awaitingFeedback: 1,
    });
  });

  it('returns zeroes for a participant with no registrations', () => {
    expect(summarize([], NOW)).toEqual({
      upcoming: 0,
      attended: 0,
      certificates: 0,
      awaitingFeedback: 0,
    });
  });
});
