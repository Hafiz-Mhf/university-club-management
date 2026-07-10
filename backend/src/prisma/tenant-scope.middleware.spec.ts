import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('tenant-scope middleware', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('throws when Membership.findMany omits organizationId', async () => {
    await expect(prisma.membership.findMany({})).rejects.toThrow(/Tenant scope violation/);
  });

  it('throws when Membership.findMany where lacks organizationId', async () => {
    await expect(
      prisma.membership.findMany({ where: { status: 'ACTIVE' } }),
    ).rejects.toThrow(/Tenant scope violation/);
  });

  it('allows Membership.findMany scoped by organizationId', async () => {
    const rows = await prisma.membership.findMany({
      where: { organizationId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(Array.isArray(rows)).toBe(true);
  });

  it('does not restrict non-tenant models (User.findMany)', async () => {
    const rows = await prisma.user.findMany({ take: 1 });
    expect(Array.isArray(rows)).toBe(true);
  });
});
