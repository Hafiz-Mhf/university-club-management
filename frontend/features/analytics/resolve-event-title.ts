import type { Event } from '@/types/api';

// Mirrors the resolveMemberName/resolveParticipantName precedent (Slices
// 5/6) — a client-side join with a raw-id fallback on a lookup miss.
export function resolveEventTitle(eventId: string, events: Event[]): string {
  return events.find((e) => e.id === eventId)?.title ?? eventId;
}
