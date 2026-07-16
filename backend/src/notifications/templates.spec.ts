import {
  registrationApprovedEmail,
  registrationWaitlistedEmail,
  registrationRejectedEmail,
  registrationPromotedEmail,
  committeeNewRegistrationEmail,
  eventReminderEmail,
} from './templates';

describe('notification email templates', () => {
  const data = { fullName: 'Alex Tan', eventTitle: 'Tech Talk' };

  it('registrationApprovedEmail includes the event title and a confirmation subject', () => {
    const { subject, text } = registrationApprovedEmail(data);
    expect(subject).toContain('Tech Talk');
    expect(subject.toLowerCase()).toContain('confirmed');
    expect(text).toContain('Alex Tan');
    expect(text).toContain('Tech Talk');
  });

  it('registrationWaitlistedEmail mentions the waitlist', () => {
    const { subject, text } = registrationWaitlistedEmail(data);
    expect(subject.toLowerCase()).toContain('waitlist');
    expect(text.toLowerCase()).toContain('waitlist');
  });

  it('registrationRejectedEmail does not claim approval', () => {
    const { subject, text } = registrationRejectedEmail(data);
    expect(subject).toContain('Tech Talk');
    expect(text.toLowerCase()).toContain('not approved');
  });

  it('registrationPromotedEmail mentions moving off the waitlist to confirmed', () => {
    const { text } = registrationPromotedEmail(data);
    expect(text.toLowerCase()).toContain('waitlist');
    expect(text.toLowerCase()).toContain('confirmed');
  });

  it('committeeNewRegistrationEmail includes registrant name, event title, and status', () => {
    const { subject, text } = committeeNewRegistrationEmail({
      eventTitle: 'Tech Talk', registrantFullName: 'Alex Tan', status: 'APPROVED',
    });
    expect(subject).toContain('Tech Talk');
    expect(text).toContain('Alex Tan');
    expect(text).toContain('APPROVED');
  });

  it('eventReminderEmail includes the venue when provided', () => {
    const startAt = new Date('2026-08-01T10:00:00.000Z');
    const { subject, text } = eventReminderEmail({
      fullName: 'Alex Tan', eventTitle: 'Tech Talk', venue: 'Main Hall', startAt,
    });
    expect(subject).toContain('Tech Talk');
    expect(text).toContain('Main Hall');
    expect(text).toContain(startAt.toISOString());
  });

  it('eventReminderEmail omits the venue line when venue is null', () => {
    const startAt = new Date('2026-08-01T10:00:00.000Z');
    const { text } = eventReminderEmail({
      fullName: 'Alex Tan', eventTitle: 'Tech Talk', venue: null, startAt,
    });
    expect(text).not.toContain(' at null');
  });
});
