export interface RegistrationOutcomeEmailData {
  fullName: string;
  eventTitle: string;
}

export function registrationApprovedEmail(data: RegistrationOutcomeEmailData): { subject: string; text: string } {
  return {
    subject: `You're confirmed: ${data.eventTitle}`,
    text: `Hi ${data.fullName},\n\nYour registration for "${data.eventTitle}" is confirmed. See you there!\n`,
  };
}

export function registrationWaitlistedEmail(data: RegistrationOutcomeEmailData): { subject: string; text: string } {
  return {
    subject: `You're on the waitlist: ${data.eventTitle}`,
    text: `Hi ${data.fullName},\n\nYou're on the waitlist for "${data.eventTitle}". We'll email you if a spot opens up.\n`,
  };
}

export function registrationRejectedEmail(data: RegistrationOutcomeEmailData): { subject: string; text: string } {
  return {
    subject: `Registration update: ${data.eventTitle}`,
    text: `Hi ${data.fullName},\n\nYour registration for "${data.eventTitle}" was not approved this time.\n`,
  };
}

export function registrationPromotedEmail(data: RegistrationOutcomeEmailData): { subject: string; text: string } {
  return {
    subject: `You're in: ${data.eventTitle}`,
    text: `Hi ${data.fullName},\n\nA spot opened up — you've been moved from the waitlist to confirmed for "${data.eventTitle}".\n`,
  };
}

export interface CommitteeNewRegistrationEmailData {
  eventTitle: string;
  registrantFullName: string;
  status: string;
}

export function committeeNewRegistrationEmail(data: CommitteeNewRegistrationEmailData): { subject: string; text: string } {
  return {
    subject: `New registration: ${data.eventTitle}`,
    text: `${data.registrantFullName} just registered for "${data.eventTitle}" (status: ${data.status}).\n`,
  };
}

export interface EventReminderEmailData {
  fullName: string;
  eventTitle: string;
  venue: string | null;
  startAt: Date;
}

export function eventReminderEmail(data: EventReminderEmailData): { subject: string; text: string } {
  const venueLine = data.venue ? ` at ${data.venue}` : '';
  return {
    subject: `Reminder: ${data.eventTitle} is tomorrow`,
    text: `Hi ${data.fullName},\n\nThis is a reminder that "${data.eventTitle}" starts at ${data.startAt.toISOString()}${venueLine}.\n`,
  };
}
