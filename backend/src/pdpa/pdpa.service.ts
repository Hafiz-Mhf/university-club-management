import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class PdpaService {
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
}
