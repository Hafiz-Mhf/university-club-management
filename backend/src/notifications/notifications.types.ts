export const NOTIFICATION_QUEUE = 'notifications';

export enum NotificationJobName {
  RegistrationApproved = 'registration.approved',
  RegistrationWaitlisted = 'registration.waitlisted',
  RegistrationRejected = 'registration.rejected',
  RegistrationPromoted = 'registration.promoted',
  RegistrationNew = 'registration.new',
  EventReminder = 'event.reminder',
}

export interface RegistrationJobPayload {
  organizationId: string;
  registrationId: string;
}

export interface CommitteeNewRegistrationJobPayload {
  organizationId: string;
  registrationId: string;
  committeeUserId: string;
}

export interface EventReminderJobPayload {
  organizationId: string;
  eventId: string;
}

export function reminderJobId(eventId: string): string {
  return `reminder:${eventId}`;
}
