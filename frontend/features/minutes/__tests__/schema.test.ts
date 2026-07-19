import { expect, it } from 'vitest';
import { minutesFormSchema } from '@/features/minutes/schema';

const base = {
  title: 'Weekly Sync',
  meetingDate: '2026-07-19',
  attendeeMembershipIds: [],
  agendaItems: [{ topic: 'Budget', notes: 'Reviewed Q3 spend' }],
  actionItems: [{ task: 'Send report', owner: 'Ada' }],
};

it('accepts a valid submission', () => {
  expect(minutesFormSchema.safeParse(base).success).toBe(true);
});

it('rejects a title under 2 characters', () => {
  expect(minutesFormSchema.safeParse({ ...base, title: 'A' }).success).toBe(false);
});

it('rejects a missing meeting date', () => {
  expect(minutesFormSchema.safeParse({ ...base, meetingDate: '' }).success).toBe(false);
});

it('rejects an agenda item missing topic or notes', () => {
  expect(minutesFormSchema.safeParse({ ...base, agendaItems: [{ topic: '', notes: 'x' }] }).success)
    .toBe(false);
  expect(minutesFormSchema.safeParse({ ...base, agendaItems: [{ topic: 'x', notes: '' }] }).success)
    .toBe(false);
});

it('rejects an action item missing a task', () => {
  expect(minutesFormSchema.safeParse({ ...base, actionItems: [{ task: '', owner: 'Ada' }] }).success)
    .toBe(false);
});

it('accepts an action item with no owner and empty agenda/action lists', () => {
  expect(minutesFormSchema.safeParse({ ...base, actionItems: [{ task: 'Follow up' }] }).success)
    .toBe(true);
  expect(
    minutesFormSchema.safeParse({
      title: 'Weekly Sync',
      meetingDate: '2026-07-19',
      attendeeMembershipIds: [],
      agendaItems: [],
      actionItems: [],
    }).success,
  ).toBe(true);
});
