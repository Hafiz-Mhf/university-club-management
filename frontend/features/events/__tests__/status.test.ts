import { expect, it } from 'vitest';
import { canCancel, canComplete, canDelete, canEdit, canPublish } from '@/features/events/status';
import type { EventStatus } from '@/types/api';

const STATUSES: EventStatus[] = ['DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED'];

it('canEdit: DRAFT and PUBLISHED only', () => {
  const expected: Record<EventStatus, boolean> = {
    DRAFT: true, PUBLISHED: true, COMPLETED: false, CANCELLED: false,
  };
  for (const s of STATUSES) expect(canEdit(s)).toBe(expected[s]);
});

it('canPublish: DRAFT only', () => {
  const expected: Record<EventStatus, boolean> = {
    DRAFT: true, PUBLISHED: false, COMPLETED: false, CANCELLED: false,
  };
  for (const s of STATUSES) expect(canPublish(s)).toBe(expected[s]);
});

it('canComplete: PUBLISHED only', () => {
  const expected: Record<EventStatus, boolean> = {
    DRAFT: false, PUBLISHED: true, COMPLETED: false, CANCELLED: false,
  };
  for (const s of STATUSES) expect(canComplete(s)).toBe(expected[s]);
});

it('canCancel: DRAFT and PUBLISHED only', () => {
  const expected: Record<EventStatus, boolean> = {
    DRAFT: true, PUBLISHED: true, COMPLETED: false, CANCELLED: false,
  };
  for (const s of STATUSES) expect(canCancel(s)).toBe(expected[s]);
});

it('canDelete: always true, any status', () => {
  for (const s of STATUSES) expect(canDelete(s)).toBe(true);
});
