import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  async findActiveByHash(tokenHash: string): Promise<{ id: string; userId: string } | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;
    return { id: row.id, userId: row.userId };
  }

  // Distinguishes "this hash was issued to someone and later rotated away"
  // from "this hash was never issued" — findActiveByHash collapses both to
  // null, which is exactly the signal reuse detection needs.
  async findRevokedByHash(tokenHash: string): Promise<{ id: string; userId: string } | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row || !row.revokedAt) return null;
    return { id: row.id, userId: row.userId };
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
