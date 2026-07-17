import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HandoverPdfService } from './handover-pdf.service';
import { HandoverService } from './handover.service';

describe('HandoverService', () => {
  let service: HandoverService;
  let prisma: {
    organization: { findUnique: jest.Mock };
    membership: { findMany: jest.Mock };
    meetingMinutes: { findMany: jest.Mock };
    asset: { findMany: jest.Mock };
    orgFile: { findMany: jest.Mock };
    event: { findMany: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let pdf: { render: jest.Mock };

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org1', name: 'Coding Club' }) },
      membership: { findMany: jest.fn().mockResolvedValue([]) },
      meetingMinutes: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      orgFile: { findMany: jest.fn().mockResolvedValue([]) },
      event: { findMany: jest.fn().mockResolvedValue([]) },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake%')) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        HandoverService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: HandoverPdfService, useValue: pdf },
      ],
    }).compile();
    service = moduleRef.get(HandoverService);
  });

  it('throws when the organization does not exist', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);
    await expect(service.generate('org1', 'actor1')).rejects.toThrow(NotFoundException);
  });

  it('scopes every query to organizationId', async () => {
    await service.generate('org1', 'actor1');

    expect(prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org1', status: 'ACTIVE' },
    }));
    expect(prisma.meetingMinutes.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org1' },
      orderBy: { meetingDate: 'desc' },
      take: 10,
    }));
    expect(prisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org1' },
      orderBy: { name: 'asc' },
    }));
    expect(prisma.orgFile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org1', category: { in: ['SOP', 'REPORT'] } },
    }));
    expect(prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org1', status: 'PUBLISHED' }),
    }));
  });

  it('maps membership rows into roster entries, parsing committeeHistory safely', async () => {
    prisma.membership.findMany.mockResolvedValue([
      { role: 'PRESIDENT', committeeHistory: [{ role: 'COMMITTEE', until: '2026-01-01T00:00:00.000Z' }], user: { fullName: 'Alex Tan' } },
      { role: 'SECRETARY', committeeHistory: null, user: { fullName: 'Sam Lee' } },
    ]);

    await service.generate('org1', 'actor1');

    expect(pdf.render).toHaveBeenCalledWith(expect.objectContaining({
      organizationName: 'Coding Club',
      roster: [
        { fullName: 'Alex Tan', role: 'PRESIDENT', history: [{ role: 'COMMITTEE', until: '2026-01-01T00:00:00.000Z' }] },
        { fullName: 'Sam Lee', role: 'SECRETARY', history: [] },
      ],
    }));
  });

  it('audits handover.generate with the organization and actor', async () => {
    await service.generate('org1', 'actor1');

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org1', actorUserId: 'actor1', action: 'handover.generate',
      targetType: 'Organization', targetId: 'org1',
    }));
  });

  it('returns the buffer produced by the PDF renderer', async () => {
    const result = await service.generate('org1', 'actor1');
    expect(result).toEqual(Buffer.from('%PDF-fake%'));
  });
});
