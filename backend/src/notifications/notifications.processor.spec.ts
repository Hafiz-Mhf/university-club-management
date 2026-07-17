import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailerService } from './mailer.service';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationJobName } from './notifications.types';

function fakeJob(name: string, data: unknown) {
  return { id: 'job1', name, data } as any;
}

describe('NotificationsProcessor', () => {
  let processor: NotificationsProcessor;
  let prisma: {
    registration: { findUnique: jest.Mock; findMany: jest.Mock };
    user: { findUnique: jest.Mock };
    event: { findUnique: jest.Mock };
    certificate: { findUnique: jest.Mock };
  };
  let mailer: { sendMail: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      registration: { findUnique: jest.fn(), findMany: jest.fn() },
      user: { findUnique: jest.fn() },
      event: { findUnique: jest.fn() },
      certificate: { findUnique: jest.fn() },
    };
    mailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MailerService, useValue: mailer },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    processor = moduleRef.get(NotificationsProcessor);
  });

  it('sends a registration.approved email and audits it', async () => {
    prisma.registration.findUnique.mockResolvedValue({
      user: { email: 'p@test.io', fullName: 'Alex Tan' },
      event: { title: 'Tech Talk' },
    });
    await processor.process(fakeJob(NotificationJobName.RegistrationApproved, { organizationId: 'org1', registrationId: 'reg1' }));
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'p@test.io' }));
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: 'org1', action: 'notification.email',
      targetType: 'Registration', targetId: 'reg1',
      metadata: { kind: NotificationJobName.RegistrationApproved },
    });
  });

  it('skips silently when the registration no longer exists', async () => {
    prisma.registration.findUnique.mockResolvedValue(null);
    await processor.process(fakeJob(NotificationJobName.RegistrationRejected, { organizationId: 'org1', registrationId: 'gone' }));
    expect(mailer.sendMail).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('sends a committee registration.new email to the committee member and audits it', async () => {
    prisma.registration.findUnique.mockResolvedValue({
      user: { fullName: 'Alex Tan' },
      event: { title: 'Tech Talk' },
      status: 'APPROVED',
    });
    prisma.user.findUnique.mockResolvedValue({ email: 'committee@test.io' });
    await processor.process(fakeJob(NotificationJobName.RegistrationNew, {
      organizationId: 'org1', registrationId: 'reg1', committeeUserId: 'u1',
    }));
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'committee@test.io' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'reg1' }));
  });

  it('sends event.reminder emails to every APPROVED registrant and audits each', async () => {
    prisma.event.findUnique.mockResolvedValue({ title: 'Tech Talk', venue: 'Hall A', startAt: new Date(), status: 'PUBLISHED' });
    prisma.registration.findMany.mockResolvedValue([
      { id: 'reg1', user: { email: 'a@test.io', fullName: 'A' } },
      { id: 'reg2', user: { email: 'b@test.io', fullName: 'B' } },
    ]);
    await processor.process(fakeJob(NotificationJobName.EventReminder, { organizationId: 'org1', eventId: 'event1' }));
    expect(mailer.sendMail).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('skips event.reminder entirely when the event is no longer PUBLISHED', async () => {
    prisma.event.findUnique.mockResolvedValue({ title: 'Tech Talk', venue: null, startAt: new Date(), status: 'CANCELLED' });
    await processor.process(fakeJob(NotificationJobName.EventReminder, { organizationId: 'org1', eventId: 'event1' }));
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('sends a certificate.ready email and audits it against the Certificate', async () => {
    prisma.certificate.findUnique.mockResolvedValue({
      user: { email: 'p@test.io', fullName: 'Alex Tan' },
      event: { title: 'Tech Talk' },
    });
    await processor.process(fakeJob(NotificationJobName.CertificateReady, { organizationId: 'org1', certificateId: 'cert1' }));
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'p@test.io' }));
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: 'org1', action: 'notification.email',
      targetType: 'Certificate', targetId: 'cert1',
      metadata: { kind: NotificationJobName.CertificateReady },
    });
  });
});
