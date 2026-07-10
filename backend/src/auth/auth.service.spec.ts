import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenRepository } from './refresh-token.repository';

describe('AuthService.register', () => {
  let service: AuthService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' }), ConfigModule.forRoot({ isGlobal: true })],
      providers: [AuthService, PrismaService, RefreshTokenRepository],
    }).compile();
    service = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('hashes the password (never stores plaintext)', async () => {
    const email = `u-${Date.now()}@test.io`;
    const res = await service.register({ email, password: 'password123', fullName: 'Jane' });
    const stored = await prisma.user.findUnique({ where: { id: res.id } });
    expect(stored!.passwordHash).not.toBe('password123');
    expect(stored!.passwordHash).toContain('$argon2');
    await prisma.user.delete({ where: { id: res.id } });
  });

  it('rejects duplicate email', async () => {
    const email = `dup-${Date.now()}@test.io`;
    const a = await service.register({ email, password: 'password123', fullName: 'A' });
    await expect(
      service.register({ email, password: 'password123', fullName: 'B' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await prisma.user.delete({ where: { id: a.id } });
  });
});
