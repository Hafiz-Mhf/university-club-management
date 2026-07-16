import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_QUEUE, NotificationJobName, reminderJobId } from './notifications.types';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let queue: { add: jest.Mock; remove: jest.Mock };
  let prisma: { membership: { findMany: jest.Mock } };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(1) };
    prisma = { membership: { findMany: jest.fn().mockResolvedValue([]) } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getQueueToken(NOTIFICATION_QUEUE), useValue: queue },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('enqueueRegistrationApproved adds a registration.approved job', async () => {
    await service.enqueueRegistrationApproved('org1', 'reg1');
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationApproved, { organizationId: 'org1', registrationId: 'reg1' });
  });

  it('enqueueRegistrationWaitlisted adds a registration.waitlisted job', async () => {
    await service.enqueueRegistrationWaitlisted('org1', 'reg1');
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationWaitlisted, { organizationId: 'org1', registrationId: 'reg1' });
  });

  it('enqueueRegistrationRejected adds a registration.rejected job', async () => {
    await service.enqueueRegistrationRejected('org1', 'reg1');
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationRejected, { organizationId: 'org1', registrationId: 'reg1' });
  });

  it('enqueueRegistrationPromoted adds a registration.promoted job', async () => {
    await service.enqueueRegistrationPromoted('org1', 'reg1');
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationPromoted, { organizationId: 'org1', registrationId: 'reg1' });
  });

  it('enqueueNewRegistrationForCommittee adds one job per ACTIVE committee-tier member', async () => {
    prisma.membership.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    await service.enqueueNewRegistrationForCommittee('org1', 'reg1');
    expect(prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org1', status: 'ACTIVE' }),
    }));
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationNew, { organizationId: 'org1', registrationId: 'reg1', committeeUserId: 'u1' });
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationNew, { organizationId: 'org1', registrationId: 'reg1', committeeUserId: 'u2' });
  });

  it('scheduleEventReminder adds a delayed job when startAt - 24h is still in the future', async () => {
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await service.scheduleEventReminder('org1', 'event1', startAt);
    expect(queue.add).toHaveBeenCalledWith(
      NotificationJobName.EventReminder,
      { organizationId: 'org1', eventId: 'event1' },
      expect.objectContaining({ jobId: reminderJobId('event1') }),
    );
    const [, , opts] = queue.add.mock.calls[0];
    expect(opts.delay).toBeGreaterThan(0);
  });

  it('scheduleEventReminder does not add a job when startAt - 24h has already passed', async () => {
    const startAt = new Date(Date.now() + 1 * 60 * 60 * 1000);
    await service.scheduleEventReminder('org1', 'event1', startAt);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('cancelEventReminder removes the deterministic reminder job id', async () => {
    await service.cancelEventReminder('event1');
    expect(queue.remove).toHaveBeenCalledWith(reminderJobId('event1'));
  });
});
