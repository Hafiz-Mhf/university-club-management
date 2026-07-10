import { Test } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService.record', () => {
  let audit: AuditService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AuditService, PrismaService],
    }).compile();
    audit = moduleRef.get(AuditService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('writes an audit row', async () => {
    const action = `test.action.${Date.now()}`;
    await audit.record({ action, actorUserId: null as any, metadata: { k: 'v' } });
    const row = await prisma.auditLog.findFirst({ where: { action } });
    expect(row).toBeTruthy();
    expect(row!.metadata).toMatchObject({ k: 'v' });
    await prisma.auditLog.delete({ where: { id: row!.id } });
  });
});
