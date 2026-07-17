export const CERTIFICATE_QUEUE = 'certificates';

export const CERTIFICATE_GENERATE_JOB = 'certificate.generate';
export const CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB = 'certificate.feedback-window-close';

export interface CertificateGenerateJobPayload {
  organizationId: string;
  eventId: string;
  userId: string;
  actorUserId?: string;
}

export interface FeedbackWindowCloseJobPayload {
  organizationId: string;
  eventId: string;
}

// BullMQ rejects custom job ids containing ':' (its Redis key separator),
// same reason notifications.types.ts uses a hyphen for reminderJobId.
export function feedbackWindowCloseJobId(eventId: string): string {
  return `feedback-window-close-${eventId}`;
}
