import { expect, it } from 'vitest';
import { DELETE_CONFIRM_TEXT, isDeleteConfirmed } from '@/features/pdpa/confirm-text';

it('is false for an empty string', () => {
  expect(isDeleteConfirmed('')).toBe(false);
});

it('is false for a near-miss', () => {
  expect(isDeleteConfirmed('delete my account')).toBe(false);
  expect(isDeleteConfirmed('DELETE MY ACCOUNT ')).toBe(false);
});

it('is true only for an exact, case-sensitive match', () => {
  expect(isDeleteConfirmed(DELETE_CONFIRM_TEXT)).toBe(true);
});
