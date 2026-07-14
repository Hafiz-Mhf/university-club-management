import { Test } from '@nestjs/testing';
import { RefreshTokenRepository } from './refresh-token.repository';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';

describe('RefreshTokenRepository', () => {
  let repo: RefreshTokenRepository;
  let prisma: PrismaService;
  let auth: AuthService;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' }), ConfigModule.forRoot({ isGlobal: true })],
      providers: [RefreshTokenRepository, PrismaService, AuthService],
    }).compile();
    repo = moduleRef.get(RefreshTokenRepository);
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    await prisma.onModuleInit();
    const u = await auth.register({ email: `rt-${Date.now()}@test.io`, password: 'password123', fullName: 'RT', consent: true });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.consentRecord.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('finds an active token, and returns null once revoked', async () => {
    const hash = `hash-${Date.now()}`;
    await repo.create(userId, hash, new Date(Date.now() + 60000));
    const found = await repo.findActiveByHash(hash);
    expect(found?.userId).toBe(userId);
    await repo.revoke(found!.id);
    expect(await repo.findActiveByHash(hash)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const hash = `exp-${Date.now()}`;
    await repo.create(userId, hash, new Date(Date.now() - 1000));
    expect(await repo.findActiveByHash(hash)).toBeNull();
  });
});
