import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('connects and round-trips an organization', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();
    const prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
    const org = await prisma.organization.create({
      data: { name: 'Test Org', slug: `t-${Date.now()}` },
    });
    expect(org.id).toBeDefined();
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  });
});
