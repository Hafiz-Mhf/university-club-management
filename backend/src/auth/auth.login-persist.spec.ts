import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { PrismaService } from '../prisma/prisma.service';
import { sha256 } from './token.util';

describe('AuthService.login persists refresh hash', () => {
  let auth: AuthService;
  let prisma: PrismaService;
  let userId: string;
  const email = `lp-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({}), ConfigModule.forRoot({ isGlobal: true })],
      providers: [AuthService, RefreshTokenRepository, PrismaService],
    }).compile();
    auth = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
    const u = await auth.register({ email, password: 'password123', fullName: 'LP' });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('stores only the hash of the issued refresh token', async () => {
    const { refreshToken } = await auth.login({ email, password: 'password123' });
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    expect(row).toBeTruthy();
    expect(row!.userId).toBe(userId);
    // raw token must never be stored
    const raw = await prisma.refreshToken.findFirst({ where: { tokenHash: refreshToken } });
    expect(raw).toBeNull();
  });
});
