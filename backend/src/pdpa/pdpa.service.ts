import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class PdpaService {
  private readonly logger = new Logger(PdpaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  consents(userId: string) {
    return this.prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { grantedAt: 'desc' },
      select: { id: true, purpose: true, policyVersion: true, grantedAt: true },
    });
  }

  async export(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { organization: { select: { name: true } } } },
        registrations: {
          include: {
            event: { select: { title: true, organization: { select: { name: true } } } },
            attendance: true,
          },
        },
        consentRecords: true,
        certificates: { include: { event: { select: { title: true } } } },
      },
    });
    if (!user) throw new NotFoundException(); // unreachable for an authenticated token; guards the type

    const certificates = await Promise.all(
      user.certificates.map(async (c) => ({
        eventTitle: c.event.title,
        fileSizeBytes: c.fileSizeBytes,
        createdAt: c.createdAt,
        downloadUrl: await this.storage.getSignedDownloadUrl(c.storageKey, SIGNED_URL_TTL_SECONDS),
      })),
    );

    await this.audit.record({
      actorUserId: userId,
      action: 'pdpa.export',
      targetType: 'User',
      targetId: userId,
    });

    return {
      profile: { id: user.id, email: user.email, fullName: user.fullName, createdAt: user.createdAt },
      memberships: user.memberships.map((m) => ({
        organizationName: m.organization.name,
        role: m.role,
        status: m.status,
        studentId: m.studentId,
        faculty: m.faculty,
        programme: m.programme,
        intake: m.intake,
        phone: m.phone,
        joinedAt: m.joinedAt,
      })),
      registrations: user.registrations.map((r) => ({
        eventTitle: r.event.title,
        organizationName: r.event.organization.name,
        status: r.status,
        answers: r.answers,
        createdAt: r.createdAt,
      })),
      attendance: user.registrations
        .filter((r) => r.attendance)
        .map((r) => ({
          eventTitle: r.event.title,
          status: r.attendance!.status,
          scannedAt: r.attendance!.scannedAt,
        })),
      consents: user.consentRecords.map((c) => ({
        purpose: c.purpose,
        policyVersion: c.policyVersion,
        grantedAt: c.grantedAt,
      })),
      certificates,
      exportedAt: new Date().toISOString(),
    };
  }

  async deleteAccount(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { organization: { select: { name: true } } } },
        registrations: { select: { id: true } },
        certificates: { select: { id: true, storageKey: true } },
      },
    });
    if (!user || user.deletedAt) return; // idempotent within the access-token window

    // Sole-president guard: an org must never be left headless.
    const headless: string[] = [];
    for (const m of user.memberships) {
      if (m.role !== 'PRESIDENT' || m.status !== 'ACTIVE') continue;
      const others = await this.prisma.membership.count({
        where: { organizationId: m.organizationId, role: 'PRESIDENT', status: 'ACTIVE', NOT: { id: m.id } },
      });
      if (others === 0) headless.push(m.organization.name);
    }
    if (headless.length > 0) {
      throw new ConflictException(
        `Transfer presidency in ${headless.join(', ')} before deleting your account`,
      );
    }

    const anonPasswordHash = await argon2.hash(randomUUID());

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${randomUUID()}@anonymized.invalid`,
          fullName: 'Deleted User',
          passwordHash: anonPasswordHash,
          mfaSecret: null,
          deletedAt: new Date(),
        },
      });
      for (const m of user.memberships) {
        // update-by-unique-id: exempt from the tenant middleware by design.
        await tx.membership.update({
          where: { id: m.id },
          data: { studentId: null, faculty: null, programme: null, intake: null, phone: null, committeeHistory: Prisma.DbNull },
        });
      }
      for (const r of user.registrations) {
        await tx.registration.update({ where: { id: r.id }, data: { answers: Prisma.DbNull } });
      }
      for (const c of user.certificates) {
        await tx.certificate.delete({ where: { id: c.id } });
      }
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      for (const m of user.memberships) {
        await this.audit.record({
          organizationId: m.organizationId,
          actorUserId: userId,
          action: 'pdpa.delete',
          targetType: 'Membership',
          targetId: m.id,
        }, tx);
      }
    });

    // Best-effort storage cleanup after commit: a failure leaves an orphaned
    // object in a private bucket with no DB pointer — log, don't fail the request.
    for (const c of user.certificates) {
      try {
        await this.storage.deleteObject(c.storageKey);
      } catch {
        this.logger.warn(`orphaned storage object after account deletion: ${c.storageKey}`);
      }
    }
  }
}
