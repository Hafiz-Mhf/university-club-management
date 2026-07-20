export const DELETE_CONFIRM_TEXT = 'DELETE MY ACCOUNT';

export function isDeleteConfirmed(value: string): boolean {
  return value === DELETE_CONFIRM_TEXT;
}
