import type { ParticipationItem, RegistrationStatus } from '@/types/api';

/**
 * What a registration status actually means for the participant, and what
 * happens next. The status badge alone said "Waitlisted" and stopped there,
 * leaving the most anxious state in the flow completely unexplained.
 */
export const STATUS_EXPLANATION: Record<RegistrationStatus, string | null> = {
  // Approved and cancelled are self-evident from the badge plus the
  // surrounding actions — extra prose there would be noise.
  APPROVED: null,
  CANCELLED: null,
  WAITLISTED:
    "This event is full. You keep your place in line, and we'll email you if a spot opens up — no need to register again.",
  REJECTED: 'The organizers did not accept this registration. Contact them if you think this is a mistake.',
};

export function statusExplanation(status: RegistrationStatus): string | null {
  return STATUS_EXPLANATION[status];
}

/** Registrations the participant still holds — the ones worth showing first. */
export function isActive(item: ParticipationItem): boolean {
  return item.status === 'APPROVED' || item.status === 'WAITLISTED';
}

export function isUpcoming(item: ParticipationItem, now: Date): boolean {
  return new Date(item.event.startAt).getTime() >= now.getTime();
}

/**
 * The single thing this participant should do next for a given event, or null
 * when the ball is not in their court. Drives the "Next up" hint on the
 * participant home so the list isn't just a wall of statuses.
 */
export type NextAction = 'show-qr' | 'give-feedback' | 'download-certificate' | null;

export function nextAction(item: ParticipationItem, now: Date): NextAction {
  if (item.status !== 'APPROVED') return null;
  if (item.hasCertificate) return 'download-certificate';
  if (item.attendance?.status === 'PRESENT' && !item.feedbackSubmitted) return 'give-feedback';
  // Before the event ends, an approved participant's job is to turn up and get
  // scanned; the check-in code is the thing they'll need at the door.
  if (item.attendance?.status === 'REGISTERED' && new Date(item.event.endAt) >= now) {
    return 'show-qr';
  }
  return null;
}

export const NEXT_ACTION_LABEL: Record<NonNullable<NextAction>, string> = {
  'show-qr': 'Show check-in code',
  'give-feedback': 'Give feedback',
  'download-certificate': 'Download certificate',
};

export interface ParticipationSummary {
  upcoming: number;
  attended: number;
  certificates: number;
  awaitingFeedback: number;
}

export function summarize(items: ParticipationItem[], now: Date): ParticipationSummary {
  return {
    upcoming: items.filter((i) => isActive(i) && isUpcoming(i, now)).length,
    attended: items.filter((i) => i.attendance?.status === 'PRESENT').length,
    certificates: items.filter((i) => i.hasCertificate).length,
    awaitingFeedback: items.filter(
      (i) => i.attendance?.status === 'PRESENT' && !i.feedbackSubmitted,
    ).length,
  };
}
