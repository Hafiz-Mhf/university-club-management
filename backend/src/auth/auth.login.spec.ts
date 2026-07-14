import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenRepository } from './refresh-token.repository';

describe('AuthService.login', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let userId: string;
  const email = `login-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' }), ConfigModule.forRoot({ isGlobal: true })],
      providers: [AuthService, PrismaService, RefreshTokenRepository],
    }).compile();
    service = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
    const u = await service.register({ email, password: 'password123', fullName: 'Log', consent: true });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.consentRecord.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('returns tokens on valid credentials', async () => {
    const res = await service.login({ email, password: 'password123' });
    expect(res.accessToken).toBeDefined();
    expect(res.refreshToken).toBeDefined();
  });

  it('rejects wrong password', async () => {
    await expect(service.login({ email, password: 'wrong' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
