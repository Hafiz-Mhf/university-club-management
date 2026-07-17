import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { CertificateGenerationService } from './certificate-generation.service';
import { CertificateGenerationProcessor } from './certificate-generation.processor';
import { CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB, CERTIFICATE_GENERATE_JOB } from './certificate-generation.types';

function fakeJob(name: string, data: unknown) {
  return { id: 'job1', name, data } as any;
}

describe('CertificateGenerationProcessor', () => {
  let processor: CertificateGenerationProcessor;
  let prisma: {
    certificate: { findFirst: jest.Mock; aggregate: jest.Mock; create: jest.Mock };
    event: { findUnique: jest.Mock };
    organization: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: { getObject: jest.Mock; putObject: jest.Mock };
  let pdf: { render: jest.Mock };
  let audit: { record: jest.Mock };
  let notifications: { enqueueCertificateReady: jest.Mock };
  let certificateGeneration: { enqueueBatchForEvent: jest.Mock };

  const jobPayload = { organizationId: 'org1', eventId: 'event1', userId: 'user1', actorUserId: 'actor1' };

  beforeEach(async () => {
    prisma = {
      certificate: {
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { fileSizeBytes: 0 } }),
        create: jest.fn().mockResolvedValue({ id: 'cert1' }),
      },
      event: { findUnique: jest.fn().mockResolvedValue({ title: 'Tech Talk', startAt: new Date() }) },
      organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Coding Club', logoKey: null, primaryColor: '#2563eb', storageQuotaMb: 1024 }) },
      user: { findUnique: jest.fn().mockResolvedValue({ fullName: 'Alex Tan' }) },
      $transaction: jest.fn((cb) => cb(prisma)),
    };
    storage = { getObject: jest.fn(), putObject: jest.fn().mockResolvedValue(undefined) };
    pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake%')) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    notifications = { enqueueCertificateReady: jest.fn().mockResolvedValue(undefined) };
    certificateGeneration = { enqueueBatchForEvent: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CertificateGenerationProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: CertificatePdfService, useValue: pdf },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
        { provide: CertificateGenerationService, useValue: certificateGeneration },
      ],
    }).compile();
    processor = moduleRef.get(CertificateGenerationProcessor);
  });

  it('renders, stores, creates the Certificate row, audits, and notifies', async () => {
    await processor.process(fakeJob(CERTIFICATE_GENERATE_JOB, jobPayload));

    expect(pdf.render).toHaveBeenCalledWith(expect.objectContaining({ participantFullName: 'Alex Tan', eventTitle: 'Tech Talk' }));
    expect(storage.putObject).toHaveBeenCalledWith('certificates/org1/event1/user1.pdf', expect.any(Buffer), 'application/pdf');
    expect(prisma.certificate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventId: 'event1', organizationId: 'org1', userId: 'user1', uploadedByUserId: 'actor1' }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'certificate.generate', targetType: 'Certificate', targetId: 'cert1',
    }), expect.anything());
    expect(notifications.enqueueCertificateReady).toHaveBeenCalledWith('org1', 'cert1');
  });

  it('skips silently when a Certificate already exists for this event+user (race guard)', async () => {
    prisma.certificate.findFirst.mockResolvedValue({ id: 'existing' });
    await processor.process(fakeJob(CERTIFICATE_GENERATE_JOB, jobPayload));
    expect(pdf.render).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.certificate.create).not.toHaveBeenCalled();
  });

  it('falls back to no logo when the logo fetch fails, and still generates the certificate', async () => {
    prisma.organization.findUnique.mockResolvedValue({ name: 'Coding Club', logoKey: 'logos/org1.png', primaryColor: '#2563eb', storageQuotaMb: 1024 });
    storage.getObject.mockRejectedValue(new Error('not found'));

    await processor.process(fakeJob(CERTIFICATE_GENERATE_JOB, jobPayload));

    expect(pdf.render).toHaveBeenCalledWith(expect.objectContaining({ orgLogoBytes: null }));
    expect(prisma.certificate.create).toHaveBeenCalled();
  });

  it('skips (no create, no audit, no notify) when generating would exceed the storage quota', async () => {
    prisma.certificate.aggregate.mockResolvedValue({ _sum: { fileSizeBytes: 1024 * 1024 * 1024 } });
    prisma.organization.findUnique.mockResolvedValue({ name: 'Coding Club', logoKey: null, primaryColor: '#2563eb', storageQuotaMb: 1 });

    await processor.process(fakeJob(CERTIFICATE_GENERATE_JOB, jobPayload));

    expect(prisma.certificate.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.enqueueCertificateReady).not.toHaveBeenCalled();
  });

  it('a feedback-window-close job re-runs the ungated batch enqueue for that event, and touches nothing else', async () => {
    await processor.process(fakeJob(CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB, { organizationId: 'org1', eventId: 'event1' }));

    expect(certificateGeneration.enqueueBatchForEvent).toHaveBeenCalledWith('org1', 'event1', undefined);
    expect(pdf.render).not.toHaveBeenCalled();
    expect(prisma.certificate.create).not.toHaveBeenCalled();
  });

  it('ignores an unrecognized job name', async () => {
    await processor.process(fakeJob('some.other.job', {}));
    expect(pdf.render).not.toHaveBeenCalled();
    expect(certificateGeneration.enqueueBatchForEvent).not.toHaveBeenCalled();
  });
});
