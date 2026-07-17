import type { EventStatus } from '@/types/api';

// Legal lifecycle transitions, mirroring backend EventsService exactly.
// Buttons for illegal transitions are never rendered (not just disabled).

export const canEdit = (s: EventStatus) => s === 'DRAFT' || s === 'PUBLISHED';
export const canPublish = (s: EventStatus) => s === 'DRAFT';
export const canComplete = (s: EventStatus) => s === 'PUBLISHED';
export const canCancel = (s: EventStatus) => s === 'DRAFT' || s === 'PUBLISHED';
export const canDelete = (_s: EventStatus) => true;
