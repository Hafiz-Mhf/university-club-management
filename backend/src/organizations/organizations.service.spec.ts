import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { RefreshTokenRepository } from '../auth/refresh-token.repository';
import { JwtModule } from '@nestjs/jwt';

describe('OrganizationsService.create', () => {
  let orgs: OrganizationsService;
  let prisma: PrismaService;
  let auth: AuthService;
  let userId: string;
  let orgId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({ secret: 'test' })],
      providers: [OrganizationsService, AuthService, PrismaService, AuditService, RefreshTokenRepository],
    }).compile();
    orgs = moduleRef.get(OrganizationsService);
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    await prisma.onModuleInit();
    const u = await auth.register({ email: `org-${Date.now()}@test.io`, password: 'password123', fullName: 'Pres', consent: true });
    userId = u.id;
  });
  afterAll(async () => {
    if (orgId) {
      await prisma.membership.deleteMany({ where: { userId, organizationId: orgId } });
    }
    await prisma.organization.deleteMany({ where: { memberships: { some: { userId } } } });
    await prisma.consentRecord.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('creates org and makes creator PRESIDENT', async () => {
    const org = await orgs.create(userId, { name: 'ACM', slug: `acm-${Date.now()}` });
    orgId = org.id;
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: org.id } },
    });
    expect(membership!.role).toBe('PRESIDENT');
  });
});
