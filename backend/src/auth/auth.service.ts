import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenRepository } from './refresh-token.repository';
import { sha256 } from './token.util';
import { CURRENT_POLICY_VERSION } from '../pdpa/policy-version';
import { isAccountConsentStale } from '../pdpa/consent-status.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        consentRecords: {
          create: { purpose: 'account', policyVersion: CURRENT_POLICY_VERSION },
        },
      },
    });
    return { id: user.id, email: user.email };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string; consentStale: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Invalid credentials');
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return this.issueTokens({ id: user.id, email: user.email });
  }

  private async issueTokens(user: { id: string; email: string }) {
    const payload = { sub: user.id, email: user.email };
    const accessTtl = this.config.get('JWT_ACCESS_TTL') ?? '900s';
    const refreshTtl = this.config.get('JWT_REFRESH_TTL') ?? '7d';
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: accessTtl,
    });
    // jti ensures uniqueness even if two tokens are signed for the same
    // user within the same second (iat has only second-level resolution).
    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti: randomUUID() },
      { secret: this.config.get('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
    );
    await this.refreshTokens.create(
      user.id,
      sha256(refreshToken),
      this.refreshExpiryDate(refreshTtl),
    );
    const consentStale = await isAccountConsentStale(this.prisma, user.id);
    return { accessToken, refreshToken, consentStale };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; consentStale: boolean }> {
    let payload: { sub: string; email: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const active = await this.refreshTokens.findActiveByHash(sha256(refreshToken));
    if (!active) throw new UnauthorizedException('Invalid refresh token');
    await this.refreshTokens.revoke(active.id); // rotate: kill the old one
    return this.issueTokens({ id: payload.sub, email: payload.email });
  }

  async logout(refreshToken: string): Promise<void> {
    const active = await this.refreshTokens.findActiveByHash(sha256(refreshToken));
    if (active) await this.refreshTokens.revoke(active.id);
  }

  // Converts a TTL like '7d' / '900s' / '30m' / '12h' to an absolute Date.
  private refreshExpiryDate(ttl: string): Date {
    const m = /^(\d+)([smhd])$/.exec(ttl);
    const seconds = m
      ? parseInt(m[1], 10) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd']
      : 7 * 86400;
    return new Date(Date.now() + seconds * 1000);
  }
}
