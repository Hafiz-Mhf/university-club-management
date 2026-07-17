import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { CertificateGenerationService } from './certificate-generation.service';
import { CERTIFICATE_GENERATE_JOB, CERTIFICATE_QUEUE } from './certificate-generation.types';

describe('CertificateGenerationService', () => {
  let service: CertificateGenerationService;
  let queue: { add: jest.Mock };
  let prisma: {
    attendance: { findMany: jest.Mock };
    certificate: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      certificate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CertificateGenerationService,
        { provide: getQueueToken(CERTIFICATE_QUEUE), useValue: queue },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(CertificateGenerationService);
  });

  it('enqueues one job per PRESENT attendee with no existing certificate', async () => {
    prisma.attendance.findMany.mockResolvedValue([
      { registration: { userId: 'u1' } },
      { registration: { userId: 'u2' } },
    ]);
    prisma.certificate.findMany.mockResolvedValue([]);

    await service.enqueueBatchForEvent('org1', 'event1', 'actor1');

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(CERTIFICATE_GENERATE_JOB, { organizationId: 'org1', eventId: 'event1', userId: 'u1', actorUserId: 'actor1' });
    expect(queue.add).toHaveBeenCalledWith(CERTIFICATE_GENERATE_JOB, { organizationId: 'org1', eventId: 'event1', userId: 'u2', actorUserId: 'actor1' });
  });

  it('skips attendees who already have a certificate', async () => {
    prisma.attendance.findMany.mockResolvedValue([
      { registration: { userId: 'u1' } },
      { registration: { userId: 'u2' } },
    ]);
    prisma.certificate.findMany.mockResolvedValue([{ userId: 'u1' }]);

    await service.enqueueBatchForEvent('org1', 'event1', 'actor1');

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(CERTIFICATE_GENERATE_JOB, { organizationId: 'org1', eventId: 'event1', userId: 'u2', actorUserId: 'actor1' });
  });

  it('enqueues nothing when there are no PRESENT attendees', async () => {
    prisma.attendance.findMany.mockResolvedValue([]);
    await service.enqueueBatchForEvent('org1', 'event1', 'actor1');
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.certificate.findMany).not.toHaveBeenCalled();
  });
});
